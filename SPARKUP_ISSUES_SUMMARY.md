# SparkupX API Issues - Quick Summary

**Partner ID:** 240054  
**Date:** February 4, 2026  
**Status:** URGENT - Production Blocking

---

## Issue #1: Missing Account Verification API

**Problem:** No account verification endpoint in Payout API documentation

**Evidence:**
- `bankList` shows `isACVerification: true` for banks
- No `/accountVerify` or similar endpoint documented
- Only 4 endpoints found: bankList, expressPay2, statusCheck, getBalance

**Request:** Provide account verification API endpoint and documentation

---

## Issue #2: BBPS payRequest 504 Timeout

**Problem:** Credit Card payments timing out at SparkupX server

**Key Evidence:**
```
Request ID: UMAZITULJX6R9AT0DIZ5TNLGOGK1MRBD
Biller: SBIC00000NATDN (SBI Credit Card)
Request Time: 2026-02-04 09:18:13 UTC
Response Time: 2026-02-04 09:19:14 UTC
Duration: 61 seconds
Error: 504 Gateway Time-out (nginx/1.18.0)
```

**Analysis:**
- Request format: ✅ Correct
- Authentication: ✅ Valid
- Provider balance: ✅ ₹5,050 available
- Our timeout: ✅ 180 seconds
- **SparkupX timeout: ❌ ~60 seconds (too short)**

**Request:** Increase nginx timeout for Credit Card billers

---

## Contact Information

**Partner ID:** 240054  
**Consumer Key:** b2078d92ff9f8e9e  
**BBPS API:** https://api.sparkuptech.in/api/ba  
**Payout API:** https://api.sparkuptech.in/api/fzep/payout

---

## Files Generated

1. `SPARKUP_SUPPORT_EMAIL_ISSUES.md` - Detailed email with full evidence
2. `SPARKUP_EMAIL_PLAINTEXT.txt` - Plain text version ready to send
3. `SPARKUP_ISSUES_SUMMARY.md` - This summary document

