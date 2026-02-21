# Draft Email: Request to Enable POS Webhook Fields

To: Razorpay POS / Integration Support  
Subject: Request to include transaction detail fields in POS webhook payload to avoid null values in partner API

---

Body:

Dear Razorpay Team,

We are integrating with Razorpay POS and consuming transaction data via your webhook notifications. Our partner API exposes this data to downstream systems, but several fields that appear in your transaction reports (e.g. dashboard / exported reports) are not present in the real-time webhook payload, which results in null values in our API and blocks our partners from building reliable integrations.

Request: Please ensure the following fields are included in the POS transaction webhook payload for every applicable transaction, so that our API response matches the data available in your reports:

| Field | Description | Example (from your report) |
|-------|-------------|----------------------------|
| Card number (masked) | Masked card number | e.g. `3611-35XX-XXXX-7447` |
| Issuing Bank | Card issuing bank name | e.g. `HDFC`, `AMEX`, `ICICI` |
| Card Classification | Card category | e.g. `STANDARD`, `PLATINUM`, `CLASSIC`, `PREPAID`, `ANY` |
| Card Txn Type | Entry mode | e.g. `EMV with PIN`, `Contactless`, `Swipe` |
| Acquiring Bank | Acquiring bank name | e.g. `HDFC`, `AMEX` |
| Merchant Name | Merchant / outlet name | As per your system |

Why this matters:
- Our partners rely on these fields for reconciliation, reporting, and downstream integrations.
- Having nulls for card/issuing bank/classification forces workarounds and prevents parity with your official report format.
- We have already aligned our API response structure with your report columns; we need the webhook to send the same data in real time.

Current behaviour:  
These fields are populated in your transaction reports but are missing or null in the webhook payload we receive, leading to null values in our partner API response.

Desired behaviour:  
Webhook payload includes the above fields (using your existing report field names or documented JSON keys such as `cardNumber`, `issuingBankName`, `cardClassification`, `cardTxnType`, `acquiringBank`, `merchantName`) for every POS transaction notification so that we do not see null for these values anywhere in our system.

Could you please confirm whether these can be enabled for our webhook endpoint, or share the correct payload specification if these are already supported under different keys?

Thank you for your support.

Best regards,  
[Your Name]  
[Company Name – Same Day Solution]  
[Contact email]
