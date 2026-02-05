# SparkupX Meeting - Quick Reference (One Page)

**Partner ID: 240054 | Date: Feb 4, 2026**

---

## 🎯 THREE CRITICAL ISSUES

### 1️⃣ Account Verification API - MISSING
- **Problem:** No endpoint in documentation, but `bankList` shows `isACVerification: true`
- **Ask:** "Does account verification API exist? What's the endpoint?"
- **Need:** API docs or confirmation it doesn't exist

### 2️⃣ BBPS payRequest - 504 TIMEOUT
- **Problem:** Credit Card payments timeout at 60 seconds
- **Evidence:** Request ID `UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD` (61 seconds)
- **Ask:** "Can you increase nginx timeout to 180 seconds?"
- **Need:** Timeout fix TODAY

### 3️⃣ Payout expressPay2 - 504 TIMEOUT
- **Problem:** IMPS/NEFT transfers timeout at 60 seconds
- **Evidence:** Request ID `PAYQT1SD88TY60D5C7X` (60 seconds)
- **Ask:** "Can you increase nginx timeout to 120-180 seconds?"
- **Need:** Timeout fix TODAY

---

## 📊 EVIDENCE SUMMARY

| Issue | Endpoint | Duration | Error | Status |
|-------|----------|----------|-------|--------|
| BBPS | `/bbps/payRequest` | 61s | 504 nginx | ❌ Timeout |
| Payout | `/expressPay2` | 60s | 504 nginx | ❌ Timeout |
| Verification | `/accountVerify` | N/A | Not found | ❌ Missing |

**Our Timeouts:** 120-180 seconds ✅  
**Their Timeout:** ~60 seconds ❌

---

## ❓ KEY QUESTIONS

1. **Account Verification:** Does API exist? What's the endpoint?
2. **BBPS Timeout:** Can you increase to 180s? Why >60s processing?
3. **Payout Timeout:** Can you increase to 120-180s? Do transfers process despite timeout?
4. **Timeline:** When can fixes be deployed?

---

## ✅ ACTION ITEMS TO GET

- [ ] Increase nginx timeout TODAY
- [ ] Clarify account verification API status
- [ ] Provide timeout recommendations
- [ ] Set follow-up date

---

## 📞 CONTACT INFO

**Partner ID:** 240054  
**Consumer Key:** b2078d92ff9f8e9e  
**BBPS API:** `https://api.sparkuptech.in/api/ba`  
**Payout API:** `https://api.sparkuptech.in/api/fzep/payout`

---

## 🔑 REQUEST IDs FOR REFERENCE

- **BBPS:** `UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD`
- **Payout:** `PAYQT1SD88TY60D5C7X`


---

**Duration: 4+ hours of downtime | Status: URGENT**



