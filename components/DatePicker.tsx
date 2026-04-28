'use client';

import { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ChevronDown, Calendar, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface DatePickerProps {
  value: string;
  onChange: (date: string) => void;
  maxDate?: string;
  minDate?: string;
  label?: string;
}

type PickerView = 'calendar' | 'month' | 'year';

function yearBounds(minDate?: string, maxDate?: string): { minY: number; maxY: number } {
  const cy = new Date().getFullYear();
  let maxY = maxDate ? parseInt(maxDate.slice(0, 4), 10) : cy;
  let minY = minDate ? parseInt(minDate.slice(0, 4), 10) : cy - 120;
  if (Number.isNaN(minY)) minY = cy - 120;
  if (Number.isNaN(maxY)) maxY = cy;
  if (minY > maxY) [minY, maxY] = [maxY, minY];
  return { minY, maxY };
}

function clampYear(y: number, minY: number, maxY: number) {
  return Math.min(Math.max(y, minY), maxY);
}

export function DatePicker({ value, onChange, maxDate, minDate, label }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [month, setMonth] = useState<number>(new Date().getMonth());
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [displayValue, setDisplayValue] = useState<string>('');
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<PickerView>('calendar');
  const anchorRef = useRef<HTMLDivElement>(null);
  const [popoverLayout, setPopoverLayout] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  const { minY, maxY } = useMemo(() => yearBounds(minDate, maxDate), [minDate, maxDate]);
  const yearsDescending = useMemo(
    () => Array.from({ length: maxY - minY + 1 }, (_, i) => maxY - i),
    [minY, maxY]
  );

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const monthNamesShort = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen || value) return;
    const cy = new Date().getFullYear();
    const preferred = cy - 30;
    setYear(clampYear(preferred, minY, maxY));
    setMonth(new Date().getMonth());
    setSelectedDay(null);
    setView('calendar');
  }, [isOpen, value, minY, maxY]);

  useEffect(() => {
    if (value) {
      const [y, m, d] = value.split('-').map(Number);
      setYear(y);
      setMonth(m - 1);
      setSelectedDay(d);
      setDisplayValue(`${d} ${monthNames[m - 1]} ${y}`);
    }
  }, [value]);

  const getDaysInMonth = (m: number, y: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDay = (m: number, y: number) => new Date(y, m, 1).getDay();

  const handleDayClick = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    if (maxDate && dateStr > maxDate) return;
    if (minDate && dateStr < minDate) return;

    onChange(dateStr);
    setSelectedDay(day);
    setDisplayValue(`${day} ${monthNames[month]} ${year}`);
    setIsOpen(false);
  };

  const goToPreviousMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear(clampYear(year - 1, minY, maxY));
    } else {
      setMonth(month - 1);
    }
  };

  const goToNextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear(clampYear(year + 1, minY, maxY));
    } else {
      setMonth(month + 1);
    }
  };

  const daysInMonth = getDaysInMonth(month, year);
  const firstDay = getFirstDay(month, year);
  const days: (number | null)[] = Array(firstDay).fill(null);
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  const isDateSelected = (day: number | null) => {
    if (!day || !selectedDay) return false;
    return day === selectedDay && value && value.includes(`${year}-${String(month + 1).padStart(2, '0')}`);
  };

  const canSelectDate = (day: number) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (maxDate && dateStr > maxDate) return false;
    if (minDate && dateStr < minDate) return false;
    return true;
  };

  const isToday = (day: number) => {
    const today = new Date();
    return day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  };

  const computeLayout = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const gap = 8;
    const pad = 12;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const panelWidth = Math.min(380, Math.max(rect.width, 320));
    let left = rect.left;
    left = Math.max(pad, Math.min(left, vw - panelWidth - pad));

    const belowTop = rect.bottom + gap;
    const spaceBelow = Math.max(0, vh - belowTop - pad);
    const spaceAbove = Math.max(0, rect.top - pad - gap);

    let maxHeight: number;
    let top: number;
    if (spaceBelow >= 450 || spaceBelow >= spaceAbove) {
      maxHeight = Math.min(spaceBelow, vh * 0.85);
      top = belowTop;
    } else {
      maxHeight = Math.min(spaceAbove, vh * 0.85);
      top = rect.top - gap - maxHeight;
      if (top < pad) {
        top = pad;
        maxHeight = Math.min(rect.top - gap - top, vh * 0.85);
      }
    }

    return { top, left, width: panelWidth, maxHeight };
  }, []);

  const repositionPopover = useCallback(() => {
    if (!isOpen) return;
    const layout = computeLayout();
    if (layout) setPopoverLayout(layout);
  }, [isOpen, computeLayout]);

  const openPicker = useCallback(() => {
    const layout = computeLayout();
    if (layout) setPopoverLayout(layout);
    setView('calendar');
    setIsOpen(true);
  }, [computeLayout]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setPopoverLayout(null);
      return;
    }
    repositionPopover();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(repositionPopover) : null;
    if (anchorRef.current && ro) ro.observe(anchorRef.current);
    window.addEventListener('resize', repositionPopover);
    window.addEventListener('scroll', repositionPopover, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', repositionPopover);
      window.removeEventListener('scroll', repositionPopover, true);
    };
  }, [isOpen, repositionPopover]);

  const handleMonthSelect = (m: number) => {
    setMonth(m);
    setView('calendar');
  };

  const handleYearSelect = (y: number) => {
    setYear(y);
    setView('calendar');
  };

  return (
    <div ref={anchorRef} className="w-full">
      <label className="block text-sm font-semibold text-gray-700 mb-2">
        {label || 'Date of Birth'} *
      </label>
      <button
        type="button"
        onClick={openPicker}
        className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-orange-500 focus:ring-4 focus:ring-orange-100 transition-all text-left bg-white flex items-center justify-between hover:border-orange-300 group"
      >
        <span className={displayValue ? 'text-gray-900 font-medium' : 'text-gray-400'}>
          {displayValue || 'Click to select date'}
        </span>
        <Calendar className="w-5 h-5 text-orange-500 group-hover:scale-110 transition-transform" />
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence>
            {isOpen && popoverLayout && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsOpen(false)}
                  className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
                />

                <motion.div
                  role="dialog"
                  aria-modal="true"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }}
                  style={{
                    position: 'fixed',
                    top: popoverLayout.top,
                    left: popoverLayout.left,
                    width: popoverLayout.width,
                    maxHeight: popoverLayout.maxHeight,
                  }}
                  className="bg-white rounded-2xl shadow-2xl z-[101] border border-orange-100 flex flex-col"
                >
                  {/* Header */}
                  <div className="bg-gradient-to-r from-orange-500 to-orange-600 p-4 text-white flex-shrink-0 rounded-t-2xl">
                    <p className="text-sm opacity-90">Select Date</p>
                    <p className="text-2xl font-bold mt-1">
                      {selectedDay 
                        ? `${dayNames[new Date(year, month, selectedDay).getDay()]}, ${monthNamesShort[month]} ${selectedDay}`
                        : 'Pick a date'
                      }
                    </p>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center justify-between p-3 bg-orange-50/50 border-b border-orange-100 flex-shrink-0 gap-2">
                    <button
                      onClick={goToPreviousMonth}
                      className="p-2 hover:bg-orange-100 rounded-full transition-colors text-orange-600 disabled:opacity-50"
                      disabled={view !== 'calendar'}
                      type="button"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>

                    <div className="flex items-center gap-2 flex-1 justify-center">
                      <button
                        onClick={() => setView(view === 'month' ? 'calendar' : 'month')}
                        type="button"
                        className={`px-3 py-1.5 rounded-lg font-semibold text-sm flex items-center gap-1 transition-all ${
                          view === 'month' 
                            ? 'bg-orange-500 text-white shadow-md' 
                            : 'bg-white text-gray-700 hover:bg-orange-100 border border-orange-200'
                        }`}
                      >
                        {monthNamesShort[month]}
                        <ChevronDown className={`w-4 h-4 transition-transform ${view === 'month' ? 'rotate-180' : ''}`} />
                      </button>
                      <button
                        onClick={() => setView(view === 'year' ? 'calendar' : 'year')}
                        type="button"
                        className={`px-3 py-1.5 rounded-lg font-semibold text-sm flex items-center gap-1 transition-all ${
                          view === 'year' 
                            ? 'bg-orange-500 text-white shadow-md' 
                            : 'bg-white text-gray-700 hover:bg-orange-100 border border-orange-200'
                        }`}
                      >
                        {year}
                        <ChevronDown className={`w-4 h-4 transition-transform ${view === 'year' ? 'rotate-180' : ''}`} />
                      </button>
                    </div>

                    <button
                      onClick={goToNextMonth}
                      className="p-2 hover:bg-orange-100 rounded-full transition-colors text-orange-600 disabled:opacity-50"
                      disabled={view !== 'calendar'}
                      type="button"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto p-4">
                    <AnimatePresence mode="wait">
                      {view === 'calendar' && (
                        <motion.div
                          key="calendar"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.15 }}
                        >
                          <div className="grid grid-cols-7 gap-1 mb-3">
                            {dayNames.map((day) => (
                              <div key={day} className="text-center text-xs font-bold text-orange-400 py-2">
                                {day}
                              </div>
                            ))}
                          </div>

                          <div className="grid grid-cols-7 gap-1">
                            {days.map((day, index) => (
                              <button
                                key={index}
                                type="button"
                                onClick={() => day && canSelectDate(day) && handleDayClick(day)}
                                disabled={!day || !canSelectDate(day || 1)}
                                className={`aspect-square rounded-full font-medium text-sm transition-all flex items-center justify-center relative ${
                                  !day
                                    ? ''
                                    : isDateSelected(day)
                                    ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg scale-110'
                                    : isToday(day)
                                    ? 'bg-orange-100 text-orange-600 font-bold ring-2 ring-orange-300'
                                    : !canSelectDate(day)
                                    ? 'text-gray-300 cursor-not-allowed'
                                    : 'text-gray-700 hover:bg-orange-50 hover:text-orange-600 cursor-pointer'
                                }`}
                              >
                                {day}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}

                      {view === 'month' && (
                        <motion.div
                          key="month"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.15 }}
                        >
                          <div className="grid grid-cols-3 gap-2">
                            {monthNames.map((m, i) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => handleMonthSelect(i)}
                                className={`py-3 px-2 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-1 ${
                                  i === month
                                    ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg'
                                    : 'bg-gray-50 text-gray-700 hover:bg-orange-100 hover:text-orange-600 border border-gray-100'
                                }`}
                              >
                                {monthNamesShort[i]}
                                {i === month && <Check className="w-4 h-4" />}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}

                      {view === 'year' && (
                        <motion.div
                          key="year"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.15 }}
                        >
                          <div className="grid grid-cols-4 gap-2 max-h-[300px] overflow-y-auto">
                            {yearsDescending.map((y) => (
                              <button
                                key={y}
                                type="button"
                                onClick={() => handleYearSelect(y)}
                                className={`py-2.5 px-1 rounded-lg font-semibold text-sm transition-all flex items-center justify-center ${
                                  y === year
                                    ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg scale-105'
                                    : 'bg-gray-50 text-gray-700 hover:bg-orange-100 hover:text-orange-600 border border-gray-100'
                                }`}
                              >
                                {y}
                              </button>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Footer */}
                  <div className="flex gap-3 p-4 border-t border-gray-100 bg-gray-50/50 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const today = new Date();
                        setYear(clampYear(today.getFullYear(), minY, maxY));
                        setMonth(today.getMonth());
                        setView('calendar');
                      }}
                      className="px-4 py-2 text-orange-600 font-semibold text-sm hover:bg-orange-50 rounded-lg transition-all"
                    >
                      Today
                    </button>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="px-5 py-2 border-2 border-gray-200 text-gray-600 font-semibold rounded-lg hover:bg-gray-100 transition-all text-sm"
                    >
                      Cancel
                    </button>
                    {selectedDay && (
                      <button
                        type="button"
                        onClick={() => {
                          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
                          onChange(dateStr);
                          setIsOpen(false);
                        }}
                        className="px-5 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-orange-700 transition-all shadow-md text-sm"
                      >
                        Select
                      </button>
                    )}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
