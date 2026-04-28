# MFS110 Biometric Data Integration Guide

## Overview

The Mantra MFS110 captures fingerprint and facial biometric data. This guide explains how to integrate the device's output with your AEPS transaction flow.

## MFS110 Device Communication

### RD Service (Registered Device Service)

The MFS110 communicates through an RD Service that runs locally:

```
MFS110 Device
    ↓ (USB/Network)
RD Service (localhost:8000 or configurable)
    ↓ (HTTP/WebSocket)
Your Application
    ↓
Biometric Data
    ↓
AEPS Transaction
```

### Common RD Service Endpoints

```
POST   http://localhost:8000/capture        - Capture fingerprint
POST   http://localhost:8000/face/capture   - Capture face
GET    http://localhost:8000/deviceInfo     - Get device info
POST   http://localhost:8000/ping           - Check connection
```

## Biometric Data Structure

### From MFS110 Device

When capturing fingerprint with MFS110, you receive data in this format:

```json
{
  "rdService": "Mantra",
  "rdVersion": "1.0.5",
  "requestId": "uuid-string",
  "timestamp": "2024-04-27T10:30:00Z",
  "capture": {
    "type": "fingerprint",
    "index": 1,
    "fingers": 1,
    "fpc": 0,
    "ci": "0007",
    "count": 1,
    "data": {
      "dc": "MFS110",
      "bioType": "FINGER",
      "dpId": "1",
      "dpName": "Mantra",
      "mi": "0",
      "mc": "1",
      "pidDataType": "0",
      "fType": "0",
      "fCount": "1",
      "iCount": "0",
      "pType": "1",
      "pCount": "1",
      "srno": "12345",
      "errCode": "0",
      "qScore": "95",
      "nmPoints": "0",
      "rdsVer": "1.0.5",
      "hmac": "signature_hash_here",
      "pidData": "BASE64_ENCODED_BIOMETRIC_DATA_HERE",
      "sessionKey": "from_aeps_wadh_api"
    }
  },
  "status": "success"
}
```

### Mapping to AEPS API

The AEPS transaction expects:

```typescript
interface BiometricData {
  bioType: 'FINGER' | 'FACE';        // From capture.data.bioType
  dc: string;                         // Device Code (usually "MFS110")
  ci: string;                         // Capture Index
  hmac: string;                       // HMAC signature
  dpId: string;                       // Device Provider ID
  mc: string;                         // Match Count
  pidDataType: string;                // PID Data Type
  mi: string;                         // Match Index
  rdsId: string;                      // RD Service ID ("Mantra")
  sessionKey: string;                 // From Wadh API
  fCount: string;                     // Finger Count
  errCode: string;                    // Error Code
  pCount: string;                     // Position Count
  fType: string;                      // Finger Type
  iCount: string;                     // Instance Count
  pType: string;                      // Position Type
  srno: string;                       // Serial Number
  pidData: string;                    // Base64 biometric data
  qScore: string;                     // Quality Score (0-100)
  nmPoints: string;                   // Non-matching Points
  rdsVer: string;                     // RD Service Version
}
```

## Implementation Example

### Step 1: Create Biometric Service

File: `services/biometric/mfs110.ts`

```typescript
/**
 * Mantra MFS110 Biometric Service
 * Handles communication with RD Service and captures fingerprint data
 */

export interface MFS110Config {
  rdServiceUrl: string;      // e.g., "http://localhost:8000"
  captureTimeout: number;    // milliseconds
  quality_score_threshold: number; // Minimum quality score (0-100)
}

export interface BiometricCaptureResult {
  success: boolean;
  data?: {
    bioType: 'FINGER' | 'FACE';
    dc: string;
    ci: string;
    hmac: string;
    dpId: string;
    mc: string;
    pidDataType: string;
    mi: string;
    rdsId: string;
    fCount: string;
    errCode: string;
    pCount: string;
    fType: string;
    iCount: string;
    pType: string;
    srno: string;
    pidData: string;
    qScore: string;
    nmPoints: string;
    rdsVer: string;
    sessionKey?: string;
  };
  error?: string;
  deviceStatus?: string;
}

class MFS110BiometricService {
  private config: MFS110Config;

  constructor(config: MFS110Config = {
    rdServiceUrl: 'http://localhost:8000',
    captureTimeout: 30000,
    quality_score_threshold: 50
  }) {
    this.config = config;
  }

  /**
   * Check if RD Service is running
   */
  async isDeviceReady(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.rdServiceUrl}/ping`, {
        method: 'GET',
        timeout: 5000
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get device information
   */
  async getDeviceInfo(): Promise<any> {
    try {
      const response = await fetch(`${this.config.rdServiceUrl}/deviceInfo`, {
        method: 'GET'
      });
      return response.json();
    } catch (error) {
      throw new Error(`Failed to get device info: ${error.message}`);
    }
  }

  /**
   * Capture fingerprint from MFS110
   */
  async captureFingerprint(sessionKey?: string): Promise<BiometricCaptureResult> {
    try {
      // Check device is ready first
      const ready = await this.isDeviceReady();
      if (!ready) {
        return {
          success: false,
          error: 'MFS110 device not detected or RD Service not running',
          deviceStatus: 'unavailable'
        };
      }

      // Request biometric capture
      const response = await fetch(`${this.config.rdServiceUrl}/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captureType: 'fingerprint',
          timeout: this.config.captureTimeout,
          quality_threshold: this.config.quality_score_threshold
        }),
        signal: AbortSignal.timeout(this.config.captureTimeout + 5000)
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Capture failed with status ${response.status}`,
          deviceStatus: 'error'
        };
      }

      const captureData = await response.json();

      // Validate captured data
      if (!captureData.success || captureData.status !== 'success') {
        return {
          success: false,
          error: captureData.error || 'Biometric capture failed',
          deviceStatus: captureData.deviceStatus || 'failed'
        };
      }

      // Validate quality score
      const qScore = parseInt(captureData.capture?.data?.qScore || '0');
      if (qScore < this.config.quality_score_threshold) {
        return {
          success: false,
          error: `Quality score too low: ${qScore}. Try again.`,
          deviceStatus: 'low_quality'
        };
      }

      // Extract and prepare biometric data for AEPS API
      const biometricData = {
        bioType: 'FINGER' as const,
        dc: captureData.capture.data.dc || 'MFS110',
        ci: captureData.capture.data.ci,
        hmac: captureData.capture.data.hmac,
        dpId: captureData.capture.data.dpId,
        mc: captureData.capture.data.mc,
        pidDataType: captureData.capture.data.pidDataType,
        mi: captureData.capture.data.mi,
        rdsId: captureData.rdService || 'Mantra',
        fCount: captureData.capture.data.fCount,
        errCode: captureData.capture.data.errCode,
        pCount: captureData.capture.data.pCount,
        fType: captureData.capture.data.fType,
        iCount: captureData.capture.data.iCount,
        pType: captureData.capture.data.pType,
        srno: captureData.capture.data.srno,
        pidData: captureData.capture.data.pidData,
        qScore: captureData.capture.data.qScore,
        nmPoints: captureData.capture.data.nmPoints,
        rdsVer: captureData.rdVersion || captureData.capture.data.rdsVer,
        sessionKey
      };

      return {
        success: true,
        data: biometricData,
        deviceStatus: 'success'
      };
    } catch (error) {
      return {
        success: false,
        error: `Biometric capture error: ${error instanceof Error ? error.message : 'Unknown'}`,
        deviceStatus: 'error'
      };
    }
  }

  /**
   * Capture face from MFS110 (if supported)
   */
  async captureFace(sessionKey?: string): Promise<BiometricCaptureResult> {
    try {
      const ready = await this.isDeviceReady();
      if (!ready) {
        return {
          success: false,
          error: 'MFS110 device not detected',
          deviceStatus: 'unavailable'
        };
      }

      const response = await fetch(`${this.config.rdServiceUrl}/face/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captureType: 'face',
          timeout: this.config.captureTimeout,
          quality_threshold: this.config.quality_score_threshold
        }),
        signal: AbortSignal.timeout(this.config.captureTimeout + 5000)
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Face capture failed with status ${response.status}`,
          deviceStatus: 'error'
        };
      }

      const captureData = await response.json();

      if (!captureData.success) {
        return {
          success: false,
          error: captureData.error || 'Face capture failed',
          deviceStatus: 'failed'
        };
      }

      const biometricData = {
        bioType: 'FACE' as const,
        dc: captureData.capture.data.dc || 'MFS110',
        ci: captureData.capture.data.ci,
        hmac: captureData.capture.data.hmac,
        dpId: captureData.capture.data.dpId,
        mc: captureData.capture.data.mc,
        pidDataType: captureData.capture.data.pidDataType,
        mi: captureData.capture.data.mi,
        rdsId: captureData.rdService || 'Mantra',
        fCount: '0', // Not applicable for face
        errCode: captureData.capture.data.errCode,
        pCount: captureData.capture.data.pCount,
        fType: captureData.capture.data.fType,
        iCount: captureData.capture.data.iCount,
        pType: captureData.capture.data.pType,
        srno: captureData.capture.data.srno,
        pidData: captureData.capture.data.pidData,
        qScore: captureData.capture.data.qScore,
        nmPoints: captureData.capture.data.nmPoints,
        rdsVer: captureData.rdVersion || captureData.capture.data.rdsVer,
        sessionKey
      };

      return {
        success: true,
        data: biometricData,
        deviceStatus: 'success'
      };
    } catch (error) {
      return {
        success: false,
        error: `Face capture error: ${error instanceof Error ? error.message : 'Unknown'}`,
        deviceStatus: 'error'
      };
    }
  }

  /**
   * Retry fingerprint capture with user feedback
   */
  async captureWithRetry(
    maxAttempts: number = 3,
    sessionKey?: string
  ): Promise<BiometricCaptureResult> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Fingerprint capture attempt ${attempt}/${maxAttempts}`);
      
      const result = await this.captureFingerprint(sessionKey);
      
      if (result.success) {
        console.log(`✓ Fingerprint captured successfully`);
        return result;
      }
      
      console.warn(`✗ Attempt ${attempt} failed: ${result.error}`);
      
      if (attempt < maxAttempts) {
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return {
      success: false,
      error: `Failed to capture fingerprint after ${maxAttempts} attempts`,
      deviceStatus: 'failed'
    };
  }
}

// Singleton instance
let mfs110Instance: MFS110BiometricService | null = null;

export function getMFS110Service(config?: MFS110Config): MFS110BiometricService {
  if (!mfs110Instance) {
    mfs110Instance = new MFS110BiometricService(config);
  }
  return mfs110Instance;
}

export { MFS110BiometricService };
```

### Step 2: Use in Transaction Flow

File: `app/api/aeps/transaction/create/route.ts` (or your transaction endpoint)

```typescript
import { getMFS110Service } from '@/services/biometric/mfs110';
import { getAEPSService } from '@/services/aeps';

export async function POST(request: Request) {
  const {
    merchantId,
    transactionType,
    amount,
    customerAadhaar,
    customerMobile,
    bankIin,
    sessionKey,
    captureBiometric = true // New parameter
  } = await request.json();

  // Validate inputs
  const aepsService = getAEPSService();
  const validation = aepsService.validateTransactionInputs({
    transactionType,
    amount: amount || 0,
    customerAadhaar,
    customerMobile,
    bankIin
  });

  if (!validation.valid) {
    return Response.json({
      success: false,
      message: 'Validation failed',
      errors: validation.errors
    }, { status: 400 });
  }

  // Check if we need to capture biometric
  let biometricData = null;
  
  if (captureBiometric) {
    try {
      const mfs110 = getMFS110Service();
      
      // Check device is ready
      const deviceReady = await mfs110.isDeviceReady();
      if (!deviceReady) {
        return Response.json({
          success: false,
          message: 'MFS110 device not detected. Check RD Service is running.',
          error: 'DEVICE_NOT_FOUND'
        }, { status: 503 });
      }
      
      // Capture fingerprint with retry
      const captureResult = await mfs110.captureWithRetry(3, sessionKey);
      
      if (!captureResult.success) {
        return Response.json({
          success: false,
          message: 'Biometric capture failed',
          error: captureResult.error,
          deviceStatus: captureResult.deviceStatus
        }, { status: 400 });
      }
      
      biometricData = captureResult.data;
    } catch (error) {
      return Response.json({
        success: false,
        message: 'Biometric capture error',
        error: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
  }

  // Process transaction with biometric data
  try {
    const result = await aepsService.processTransaction({
      userId: 'current_user',
      userRole: 'retailer',
      merchantId,
      transactionType,
      amount,
      customerAadhaar,
      customerMobile,
      bankIin,
      biometricData: biometricData || undefined
    });

    return Response.json(result);
  } catch (error) {
    return Response.json({
      success: false,
      message: 'Transaction failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
```

### Step 3: Use in React Component

```typescript
import { useState } from 'react';
import { getMFS110Service } from '@/services/biometric/mfs110';

export function AEPSTransaction() {
  const [loading, setLoading] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState<string>('');

  async function submitTransaction() {
    setLoading(true);
    setBiometricStatus('Starting fingerprint capture...');

    try {
      // Initiate transaction with automatic biometric capture
      const response = await fetch('/api/aeps/transaction/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantId: 'YOUR_MERCHANT_ID',
          transactionType: 'cash_withdrawal',
          amount: 500,
          customerAadhaar: 'XXXX XXXX 1234',
          customerMobile: '9876543210',
          bankIin: '607094',
          captureBiometric: true // Enable automatic capture
        })
      });

      const result = await response.json();

      if (result.success) {
        setBiometricStatus('✓ Transaction successful!');
        console.log('Transaction UTR:', result.utr);
      } else {
        setBiometricStatus(`✗ ${result.message}`);
      }
    } catch (error) {
      setBiometricStatus(`✗ Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={submitTransaction} disabled={loading}>
        {loading ? 'Processing...' : 'Withdraw'}
      </button>
      {biometricStatus && <p>{biometricStatus}</p>}
    </div>
  );
}
```

## Error Handling

### Common Biometric Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `DEVICE_NOT_FOUND` | RD Service not running | Start RD Service and restart app |
| `Low quality` | Fingerprint too faint | Clean finger and try again |
| `Timeout` | User didn't place finger in time | Extend timeout or prompt again |
| `Device busy` | Another capture in progress | Wait and retry |

## Security Best Practices

1. **Never Log Full Biometric Data**
   ```typescript
   // BAD: Don't do this
   console.log(biometricData.pidData);
   
   // GOOD: Log only status
   console.log(`Capture successful, quality: ${biometricData.qScore}`);
   ```

2. **Encrypt Biometric Data in Transit**
   - Always use HTTPS
   - Encrypt sensitive fields

3. **Session Key Management**
   - Get fresh Wadh before each capture
   - Wadh expires after Xminutes (check with Chagans)

4. **Secure RD Service**
   - Don't expose RD Service to internet
   - Firewall localhost port 8000

## Testing

### Without MFS110 (Mock Mode)

For development without hardware:

```typescript
async function captureFingerprintMock(): Promise<BiometricCaptureResult> {
  // Simulate delay
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  return {
    success: true,
    data: {
      bioType: 'FINGER',
      dc: 'MFS110',
      ci: '0001',
      hmac: 'mock_hmac_signature',
      dpId: '1',
      mc: '1',
      pidDataType: '0',
      mi: '0',
      rdsId: 'Mantra',
      fCount: '1',
      errCode: '0',
      pCount: '1',
      fType: '0',
      iCount: '0',
      pType: '1',
      srno: 'MOCK001',
      pidData: 'BASE64_MOCK_DATA',
      qScore: '95',
      nmPoints: '0',
      rdsVer: '1.0.5'
    },
    deviceStatus: 'success'
  };
}
```

## Next Steps

1. Install Mantra RD Service on your dev machine
2. Connect MFS110 device
3. Test RD Service connectivity: `curl http://localhost:8000/ping`
4. Create `services/biometric/mfs110.ts` using the example above
5. Integrate into your transaction flow
6. Test with `npm run dev` and manual transaction

---

**Document Version:** 1.0
**Last Updated:** April 27, 2026
**Compatibility:** MFS110, MFS100 (with adjustments)
