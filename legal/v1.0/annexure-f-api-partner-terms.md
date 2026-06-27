# ANNEXURE-F

## API PARTNER TERMS & CONDITIONS

**Document Reference:** SDS-MSA-ANNEXURE-F-v1.0  
**Master Service Agreement Reference:** SDS-MSA-v1.0  
**Effective Date:** _______________

---

## PARTIES

**SAMEDAY SOLUTIONS PRIVATE LIMITED**  
Registered Office: TF-11B, 3rd Floor, Eros Metro Mall, Dwarka Sector-14, New Delhi – 110078  
("**Company**" / "**Sameday**")

**AND**

**API Partner / Agent Legal Name:** ________________________________  
**Partner Code / API Client ID:** ________________________________  
("**Partner**" / "**API Partner**")

---

## 1. PURPOSE AND INCORPORATION

1.1 This Annexure-F sets forth the terms governing access to and use of Application Programming Interfaces ("**APIs**") provided by the Company to the Partner under the Master Service Agreement ("**MSA**").

1.2 This Annexure is incorporated by reference into the MSA. In case of conflict between this Annexure and the MSA on API-specific matters, this Annexure shall prevail. Regulatory mandates shall prevail over both.

1.3 Access to APIs is a privilege, not a right, and is subject to technical approval, security review, and ongoing compliance.

---

## 2. DEFINITIONS

2.1 **"API Credentials"** means API keys, client IDs, client secrets, bearer tokens, refresh tokens, signing keys, and any authentication material issued to the Partner.

2.2 **"API Documentation"** means technical specifications, endpoint references, sample payloads, error codes, and integration guides published by the Company.

2.3 **"Environment"** means sandbox (UAT) or production, as separately provisioned.

2.4 **"IP Whitelist"** means the list of static IP addresses authorized to call production APIs.

2.5 **"Rate Limit"** means the maximum number of API requests permitted per second, minute, hour, or day as configured for the Partner.

2.6 **"Webhook"** means HTTPS callback URLs registered by the Partner to receive asynchronous event notifications from the Company.

2.7 **"Prohibited Data"** means full card PAN, CVV, PIN, magnetic stripe data, raw biometric templates, Aadhaar full numbers (where masking is mandated), and any data whose storage is prohibited by PCI-DSS, UIDAI, RBI, or NPCI.

---

## 3. API ACCESS AND PROVISIONING

3.1 API access shall be provisioned only after:
   (a) Successful completion of MSA onboarding and KYC;
   (b) Technical integration review;
   (c) Execution of this Annexure;
   (d) Completion of sandbox testing and sign-off;
   (e) IP Whitelist submission for production;
   (f) Company approval in writing or via dashboard activation.

3.2 The Company may offer APIs for one or more products including AEPS, DMT, BBPS, wallet, QR status, balance enquiry, transaction status, settlement reports, and commission statements, as enabled for the Partner.

3.3 The Partner shall designate a technical contact and security contact with valid email and mobile for incident communication.

3.4 The Partner shall not share API Credentials with any third party except approved sub-processors bound by equivalent confidentiality and security obligations with prior Company consent.

3.5 Production credentials shall be issued separately from sandbox credentials and must never be embedded in client-side/mobile code in recoverable form.

---

## 4. API KEYS, SECRETS, AND AUTHENTICATION

4.1 API Credentials are confidential and proprietary to the Company. The Partner receives a limited, revocable license to use them solely for authorized integration.

4.2 The Partner shall:
   (a) Store secrets in secure vaults or environment variables;
   (b) Rotate credentials upon employee exit, suspected compromise, or Company direction;
   (c) Never commit credentials to public repositories (GitHub, GitLab, etc.);
   (d) Never transmit secrets via unencrypted channels;
   (e) Use separate credentials for sandbox and production.

4.3 The Partner must report suspected or actual credential compromise to **security@samedaysolution.in** within **one (1) hour** of discovery.

4.4 The Company may immediately revoke, rotate, or suspend API Credentials upon security concern, breach, or Agreement violation without liability.

4.5 The Partner is fully liable for all API activity conducted using its Credentials until revocation and confirmed replacement.

4.6 Request signing (HMAC-SHA256 or as specified in API Documentation) must be implemented where mandated.

---

## 5. IP WHITELISTING

5.1 Production API access is restricted to IP addresses submitted and approved in the IP Whitelist form.

5.2 The Partner shall provide static egress IP addresses only; dynamic IPs are not permitted for production unless approved with additional controls.

5.3 Changes to IP Whitelist require submission via dashboard/ticket and may take up to two (2) Business Days to propagate.

5.4 The Company may block traffic from non-whitelisted IPs without notice.

5.5 Where the Partner uses cloud infrastructure, the Partner shall configure NAT gateways or fixed egress IPs and document cloud region and provider.

5.6 VPN or proxy routing that obscures true origin IP is prohibited unless disclosed and approved.

---

## 6. RATE LIMITS AND FAIR USE

6.1 Default rate limits apply per endpoint and aggregate account level as published in API Documentation or partner dashboard.

6.2 Indicative default limits (subject to change):

| Tier | Requests/Second | Requests/Minute | Daily Cap |
|------|-----------------|-----------------|-----------|
| Standard | 10 | 300 | 50,000 |
| Enhanced | 25 | 750 | 200,000 |
| Enterprise | By agreement | By agreement | By agreement |

6.3 Exceeding Rate Limits may result in HTTP 429 responses, throttling, temporary blocking, or downgrade of tier.

6.4 The Partner shall implement exponential backoff, retry logic, and idempotency keys for safe retries.

6.5 Scraping, bulk polling, stress testing, or load testing against production without prior written approval is prohibited.

6.6 Rate limit increases may be requested with business justification; approval is at Company discretion.

---

## 7. WEBHOOKS AND CALLBACKS

7.1 Webhooks must use **HTTPS** endpoints with valid TLS certificates from recognized certificate authorities.

7.2 Self-signed certificates, HTTP (non-TLS), and IP-based callback URLs are not permitted for production.

7.3 The Partner shall verify webhook signatures using the shared secret or public key method specified in API Documentation.

7.4 Webhook endpoints must respond with HTTP 2xx within ten (10) seconds; repeated failures may result in webhook suspension.

7.5 The Partner shall implement idempotent processing of webhook events using unique event IDs.

7.6 The Company may retry failed webhook deliveries for up to seventy-two (72) hours.

7.7 The Partner shall not expose webhook URLs publicly or without authentication/firewall controls.

7.8 Webhook payload may contain transaction status, settlement events, Chargeback alerts, and KYC status updates.

---

## 8. PROHIBITED DATA STORAGE

8.1 **The Partner shall NOT store, log, cache, or persist:**
   (a) Full debit/credit card numbers (PAN);
   (b) CVV, PIN, or PIN blocks;
   (c) Magnetic stripe or chip track data;
   (d) Raw biometric templates (fingerprint/iris images);
   (e) Aadhaar numbers except as permitted by UIDAI and only in masked/encrypted form if at all;
   (f) API client secrets in application logs;
   (g) End Customer passwords or OTPs.

8.2 Transaction logs may store transaction IDs, masked identifiers, amounts, timestamps, status codes, and reference numbers only.

8.3 PCI-DSS and UIDAI compliance is the Partner's responsibility where Partner systems touch regulated data flows.

8.4 Violation of this Section constitutes material breach and grounds for immediate API suspension and termination.

8.5 The Company may audit Partner systems upon reasonable notice to verify compliance with data storage prohibitions.

---

## 9. RECONCILIATION — DAILY MANDATORY

9.1 The Partner shall perform **daily reconciliation** of all API-initiated transactions against:
   (a) Company settlement reports;
   (b) Partner internal ledger;
   (c) Bank statements (where applicable).

9.2 Reconciliation must be completed by **11:00 AM IST** on the Business Day following the transaction date (T+1 morning).

9.3 Discrepancies must be raised via support ticket or dispute API within **three (3) Business Days** with transaction IDs, timestamps, and request/response logs.

9.4 Failure to reconcile daily does not relieve the Partner of liability for Chargebacks, duplicates, or erroneous credits.

9.5 The Company may provide reconciliation APIs, SFTP reports, or dashboard exports; the Partner shall automate retrieval where volume exceeds one hundred (100) transactions per day.

9.6 Unresolved mismatches exceeding INR 1,000 for more than five (5) Business Days may trigger Hold on settlements.

9.7 The Partner shall retain API request/response logs (excluding Prohibited Data) for minimum **eight (8) years**.

---

## 10. TECHNICAL STANDARDS AND SECURITY

10.1 All API calls must use TLS 1.2 or higher.

10.2 The Partner shall patch servers, update dependencies, and remediate critical CVEs within timelines communicated by the Company or thirty (30) days, whichever is shorter.

10.3 Multi-factor authentication must be enabled on Partner admin dashboards and deployment pipelines.

10.4 The Partner shall conduct annual vulnerability assessment for production integration servers.

10.5 Penetration test summaries may be requested by the Company for high-volume partners.

10.6 The Partner shall not reverse engineer, decompile, or attempt to derive source code from APIs or SDKs.

---

## 11. NO SERVICE LEVEL AGREEMENT (NO SLA)

11.1 **THE COMPANY PROVIDES APIs ON A BEST-EFFORT, "AS IS" AND "AS AVAILABLE" BASIS WITHOUT ANY SERVICE LEVEL AGREEMENT (SLA), UPTIME GUARANTEE, OR PERFORMANCE WARRANTY.**

11.2 The Company does not guarantee:
   (a) Uninterrupted API availability;
   (b) Error-free responses;
   (c) Fixed response latency;
   (d) Permanent backward compatibility of endpoints;
   (e) Availability during bank/NPCI/RBI maintenance windows.

11.3 Scheduled maintenance shall be announced via email/dashboard where practicable; emergency maintenance may occur without notice.

11.4 The Partner shall implement graceful degradation, circuit breakers, and customer communication for outages.

11.5 No credits, refunds, or penalties apply for API downtime unless separately agreed in a signed Enterprise SLA addendum (not applicable by default under this Annexure).

11.6 **Bank, NPCI, issuer, and third-party network downtime is expressly excluded from any performance commitment.**

---

## 12. API CHANGES, DEPRECATION, AND VERSIONING

12.1 The Company may modify, add, or deprecate API endpoints, fields, and authentication methods.

12.2 Minimum thirty (30) days' notice shall be provided for breaking changes where feasible, except for regulatory/security emergencies.

12.3 Deprecated endpoints may be disabled after notice period; continued use after deprecation deadline is at Partner's risk.

12.4 The Partner shall migrate to new API versions within the communicated timeline.

12.5 API Documentation on the developer portal constitutes the authoritative reference.

---

## 13. MONITORING, LOGGING, AND AUDIT

13.1 The Company logs API requests for fraud detection, debugging, billing, and compliance.

13.2 The Partner consents to monitoring of API traffic patterns, geolocation, velocity, and anomaly detection.

13.3 Unusual patterns (credential stuffing, brute force, abnormal volume spikes) may trigger automatic suspension.

13.4 The Company may request API access logs and integration architecture diagrams during audits.

13.5 The Partner shall cooperate with regulatory inspections involving API transaction trails.

---

## 14. FEES AND CHARGING

14.1 API access may be subject to setup fees, monthly platform fees, per-transaction fees, or enhanced tier charges as per Annexure-B (Fee Schedule) of the MSA.

14.2 Non-payment may result in API suspension independent of other Services.

14.3 Fees are exclusive of GST unless stated otherwise.

---

## 15. SUSPENSION AND TERMINATION OF API ACCESS

15.1 The Company may suspend or terminate API access immediately, with or without notice, upon:
   (a) Breach of this Annexure or MSA;
   (b) Security compromise or failure to rotate credentials;
   (c) Storage of Prohibited Data;
   (d) IP Whitelist violation or API abuse;
   (e) Non-payment;
   (f) Fraud, AML alert, or Fake Documents;
   (g) Regulatory or bank direction;
   (h) Excessive Chargebacks;
   (i) Failure to perform daily reconciliation;
   (j) Load testing or scraping without approval.

15.2 Suspension may include revocation of credentials, blocking of Webhooks, and Hold on settlements.

15.3 Reinstatement requires remediation plan, security attestation, and Company approval.

15.4 Upon termination, the Partner shall cease all API calls, destroy Credentials, and certify deletion within forty-eight (48) hours.

15.5 Surviving clauses: Prohibited Data, Reconciliation records, Indemnity, Confidentiality, Limitation of Liability, Dispute Resolution.

---

## 16. INDEMNITY — API SPECIFIC

16.1 The Partner shall **indemnify, defend, and hold harmless** the Company, its directors, officers, employees, banks, and technology partners from all claims, losses, damages, penalties, and costs (including reasonable legal fees) arising from:

   (a) API misuse, credential compromise due to Partner negligence, or unauthorized third-party access via Partner systems;
   (b) Storage, logging, or leakage of Prohibited Data by the Partner;
   (c) Failure to implement HTTPS, IP Whitelist, webhook signature verification, or other required security controls;
   (d) Customer disputes, duplicate credits, or erroneous transactions caused by Partner integration errors;
   (e) Violation of PCI-DSS, UIDAI, RBI, NPCI, or DPDP Act through Partner systems;
   (f) Penetration attacks originating from Partner infrastructure due to inadequate patching;
   (g) Regulatory fines attributable to Partner non-compliance;
   (h) Downline or sub-processor breaches where Partner granted access.

16.2 Indemnity procedures follow MSA Clause 34.

16.3 The Partner's API-related indemnity obligations are **unlimited** for fraud and Prohibited Data violations.

---

## 17. LIMITATION OF LIABILITY — API

17.1 Subject to MSA Clause 35, the Company shall not be liable for:
   (a) API unavailability, latency, or errors;
   (b) Data loss due to Partner misconfiguration;
   (c) Indirect or consequential damages from integration failures;
   (d) Third-party network or banking system failures.

17.2 Aggregate Company liability for API-related claims is capped as per MSA Clause 35.

17.3 Partner liability for API abuse, data breaches, and indemnity events is uncapped.

---

## 18. CONFIDENTIALITY

18.1 API Documentation, Credentials, unpublished endpoints, and sandbox behavior are Confidential Information.

18.2 The Partner shall not disclose API Documentation to competitors or use it to build competing services.

18.3 Confidentiality survives termination for five (5) years or longer as per MSA.

---

## 19. SUPPORT AND INCIDENT MANAGEMENT

19.1 API support is available via **api-support@samedaysolution.in** during Business Hours.

19.2 Severity definitions:

| Severity | Description | Target Response |
|----------|-------------|-----------------|
| P1 — Critical | Production down, security breach | 2 hours |
| P2 — High | Major feature degraded | 4 Business Hours |
| P3 — Medium | Non-critical defect | 1 Business Day |
| P4 — Low | Enhancement/query | 3 Business Days |

19.3 Response targets are best-effort and **not SLA commitments** unless Enterprise SLA is signed.

19.4 Security incidents must be reported to **security@samedaysolution.in** immediately.

---

## 20. REPRESENTATIONS AND WARRANTIES

20.1 The Partner represents that its integration systems comply with Applicable Law and this Annexure.

20.2 The Partner represents that it has implemented adequate security for API Credentials and customer data.

20.3 The Partner represents that daily reconciliation processes are in place.

20.4 THE COMPANY DISCLAIMS ALL WARRANTIES NOT EXPRESSLY SET FORTH, INCLUDING MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE.

---

## 21. GOVERNING LAW AND DISPUTES

21.1 This Annexure is governed by the laws of India.

21.2 Disputes shall be resolved as per MSA Clause 39 (Arbitration, New Delhi) and Clause 40 (Governing Law).

---

## 22. ACCEPTANCE

### FOR SAMEDAY SOLUTIONS PRIVATE LIMITED

| | |
|---|---|
| **Authorized Signatory** | ________________________________ |
| **Signature** | ________________________________ |
| **Date** | ________________________________ |

### FOR THE API PARTNER

| | |
|---|---|
| **Legal Entity Name** | ________________________________ |
| **Technical Contact** | ________________________________ |
| **Security Contact** | ________________________________ |
| **Production IP(s) Whitelisted** | ________________________________ |
| **Webhook URL (HTTPS)** | ________________________________ |
| **Authorized Signatory** | ________________________________ |
| **Signature** | ________________________________ |
| **Date** | ________________________________ |

---

### DIGITAL ACCEPTANCE (IF APPLICABLE)

| Field | Value |
|-------|-------|
| Client ID | ________________________________ |
| OTP / eSign Reference | ________________________________ |
| IP Address | ________________________________ |
| Timestamp (IST) | ________________________________ |
| Document Version | SDS-MSA-ANNEXURE-F-v1.0 |

---

**END OF ANNEXURE-F**

*Incorporated by reference into Master Service Agreement SDS-MSA-v1.0*
