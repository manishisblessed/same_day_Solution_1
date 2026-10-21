/**
 * Report export utility.
 * CSV: writes file to device storage via expo-file-system, then offers share.
 * PDF: requires expo-print + expo-sharing native modules (needs a production build).
 */
import { Share, Alert, Platform } from 'react-native';

export interface ExportRow {
  [key: string]: string | number | undefined | null;
}

function toCSV(columns: string[], rows: ExportRow[]): string {
  const escape = (v: any) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const header = columns.map(escape).join(',');
  const body = rows.map((r) => columns.map((c) => escape(r[c])).join(',')).join('\n');
  return `${header}\n${body}`;
}

function toHTML(title: string, columns: string[], rows: ExportRow[]): string {
  const thCells = columns.map((c) => `<th>${c}</th>`).join('');
  const tdRows = rows
    .map((r) => `<tr>${columns.map((c) => `<td>${r[c] ?? ''}</td>`).join('')}</tr>`)
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;margin:24px}
  h2{margin-bottom:6px}p{color:#666;margin-bottom:14px;font-size:10px}
  table{width:100%;border-collapse:collapse}
  th{background:#1e3a5f;color:#fff;padding:7px 8px;text-align:left;font-size:10px}
  td{padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:10px}
  tr:nth-child(even) td{background:#f9fafb}
</style></head><body>
<h2>${title}</h2>
<p>Generated: ${new Date().toLocaleString('en-IN')} &nbsp;|&nbsp; ${rows.length} record(s)</p>
<table><thead><tr>${thCells}</tr></thead><tbody>${tdRows}</tbody></table>
</body></html>`;
}

async function shareAsText(title: string, filename: string, csv: string) {
  try {
    await Share.share(
      { message: csv, title: `${filename}.csv` },
      { dialogTitle: `Export ${title}` }
    );
  } catch (e: any) {
    if (e?.message !== 'The user did not share') {
      Alert.alert('Export failed', e?.message || 'Could not export the file.');
    }
  }
}

async function saveCSV(title: string, filename: string, csv: string) {
  let FileSystem: any;
  try {
    // SDK 54: classic API lives under the /legacy entry point.
    FileSystem = await import('expo-file-system/legacy');
  } catch {
    FileSystem = null;
  }

  // Android: save directly to a user-picked folder (e.g. Downloads) via SAF.
  if (Platform.OS === 'android' && FileSystem?.StorageAccessFramework) {
    try {
      const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (perm.granted) {
        const uri = await FileSystem.StorageAccessFramework.createFileAsync(
          perm.directoryUri,
          filename,
          'text/csv'
        );
        await FileSystem.writeAsStringAsync(uri, csv, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        Alert.alert('Report Downloaded', `"${filename}.csv" saved to the selected folder.`);
        return;
      }
      // User denied folder access → fall back to share.
      await shareAsText(title, filename, csv);
      return;
    } catch (e: any) {
      await shareAsText(title, filename, csv);
      return;
    }
  }

  // iOS / fallback: write into app documents then share.
  if (FileSystem?.documentDirectory) {
    try {
      const savePath = `${FileSystem.documentDirectory}${filename}.csv`;
      await FileSystem.writeAsStringAsync(savePath, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      Alert.alert('Report Downloaded', `"${filename}.csv" saved successfully.`, [
        {
          text: 'Share',
          onPress: () =>
            Share.share({ message: csv, title: `${filename}.csv` }, { dialogTitle: `Share ${title}` }),
        },
        { text: 'OK', style: 'cancel' },
      ]);
      return;
    } catch {
      /* fall through */
    }
  }

  await shareAsText(title, filename, csv);
}

function isPdfNativeError(e: any): boolean {
  const msg: string = e?.message ?? '';
  return (
    msg.includes('native module') ||
    msg.includes('ExpoSharing') ||
    msg.includes('ExpoFileSystem') ||
    msg.includes('ExpoPrint') ||
    msg.includes('is not a function') ||
    msg.includes('undefined') ||
    e?.code === 'ERR_MODULE_NOT_FOUND'
  );
}

async function sharePDF(title: string, filename: string, html: string) {
  try {
    const Print = await import('expo-print');
    const Sharing = await import('expo-sharing');

    if (typeof Print?.printToFileAsync !== 'function') {
      throw new Error('ExpoPrint native module not available');
    }

    const { uri: pdfUri } = await Print.printToFileAsync({ html, base64: false });
    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      dialogTitle: `Export ${title}`,
    });
  } catch (e: any) {
    if (isPdfNativeError(e)) {
      Alert.alert(
        'PDF Not Available',
        'PDF export requires a production build with native modules. Please use CSV export instead.',
        [{ text: 'OK' }]
      );
    } else {
      Alert.alert('Export Failed', e?.message || 'Could not generate PDF.');
    }
  }
}

export async function exportReport(opts: {
  title: string;
  filename: string;
  columns: string[];
  rows: ExportRow[];
  format: 'csv' | 'pdf';
}) {
  const { title, filename, columns, rows, format } = opts;
  if (format === 'csv') {
    await saveCSV(title, filename, toCSV(columns, rows));
  } else {
    await sharePDF(title, filename, toHTML(title, columns, rows));
  }
}

/** Prompt user to pick CSV or PDF, then export. */
export function promptAndExport(opts: Omit<Parameters<typeof exportReport>[0], 'format'>) {
  Alert.alert(
    'Download Report',
    `Export "${opts.title}" (${opts.rows.length} records) as:`,
    [
      { text: 'CSV', onPress: () => saveCSV(opts.title, opts.filename, toCSV(opts.columns, opts.rows)) },
      { text: 'PDF', onPress: () => exportReport({ ...opts, format: 'pdf' }) },
      { text: 'Cancel', style: 'cancel' },
    ]
  );
}
