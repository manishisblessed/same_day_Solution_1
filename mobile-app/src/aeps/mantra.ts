import { Platform } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

/**
 * Mantra L1 (MFS100 / L1) fingerprint capture via the UIDAI RD Service on Android.
 *
 * The RD service is a separate installed app that exposes intents:
 *   - in.gov.uidai.rdservice.fp.INFO     → device info / availability
 *   - in.gov.uidai.rdservice.fp.CAPTURE  → capture, returns PidData XML in extra "PID_DATA"
 *
 * iOS is NOT supported: Apple does not allow USB/L1 biometric AEPS capture, and
 * Mantra L1 has no iOS driver. AEPS is therefore Android-only.
 */

export const RD_CAPTURE_ACTION = 'in.gov.uidai.rdservice.fp.CAPTURE';
export const RD_INFO_ACTION = 'in.gov.uidai.rdservice.fp.INFO';

export interface BiometricFields {
  bioType: 'FINGER';
  pidData: string;
  sessionKey: string;
  ci: string;
  hmac: string;
  dc: string;
  dpId: string;
  mc: string;
  mi: string;
  rdsId: string;
  rdsVer: string;
  srno: string;
  pidDataType: string;
  fCount: string;
  fType: string;
  pCount: string;
  pType: string;
  iCount: string;
  errCode: string;
  qScore: string;
  nmPoints: string;
}

export class BiometricError extends Error {
  code: string;
  constructor(message: string, code = 'CAPTURE_FAILED') {
    super(message);
    this.name = 'BiometricError';
    this.code = code;
  }
}

function attr(xml: string, tag: string, name: string): string {
  // <tag ... name="value" ...>
  const tagMatch = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(xml);
  if (!tagMatch) return '';
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tagMatch[0]);
  return m ? m[1] : '';
}

function text(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m ? m[1].trim() : '';
}

function paramValue(xml: string, name: string): string {
  const m = new RegExp(`<Param\\b[^>]*name\\s*=\\s*"${name}"[^>]*value\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  if (m) return m[1];
  const m2 = new RegExp(`<Param\\b[^>]*value\\s*=\\s*"([^"]*)"[^>]*name\\s*=\\s*"${name}"`, 'i').exec(xml);
  return m2 ? m2[1] : '';
}

/** Parse the RD-service PidData XML into the flat field set the backend expects. */
export function parsePidData(xml: string): BiometricFields {
  const errCode = attr(xml, 'Resp', 'errCode');
  if (errCode && errCode !== '0') {
    const errInfo = attr(xml, 'Resp', 'errInfo') || 'Device error';
    throw new BiometricError(`RD service error ${errCode}: ${errInfo}`, `RD_${errCode}`);
  }
  const data = text(xml, 'Data');
  const skey = text(xml, 'Skey');
  if (!data || !skey) {
    throw new BiometricError('Capture returned no biometric data. Please retry.', 'EMPTY_PID');
  }
  return {
    bioType: 'FINGER',
    pidData: data,
    sessionKey: skey,
    ci: attr(xml, 'Skey', 'ci'),
    hmac: text(xml, 'Hmac'),
    dc: attr(xml, 'DeviceInfo', 'dc'),
    dpId: attr(xml, 'DeviceInfo', 'dpId'),
    mc: attr(xml, 'DeviceInfo', 'mc'),
    mi: attr(xml, 'DeviceInfo', 'mi'),
    rdsId: attr(xml, 'DeviceInfo', 'rdsId'),
    rdsVer: attr(xml, 'DeviceInfo', 'rdsVer'),
    srno: paramValue(xml, 'srno'),
    pidDataType: attr(xml, 'Data', 'type'),
    fCount: attr(xml, 'Resp', 'fCount'),
    fType: attr(xml, 'Resp', 'fType'),
    pCount: attr(xml, 'Resp', 'pCount'),
    pType: attr(xml, 'Resp', 'pType'),
    iCount: attr(xml, 'Resp', 'iCount'),
    errCode: errCode || '0',
    qScore: attr(xml, 'Resp', 'qScore'),
    nmPoints: attr(xml, 'Resp', 'nmPoints'),
  };
}

function buildPidOptions(wadh: string): string {
  const wadhAttr = wadh ? ` wadh="${wadh}"` : '';
  return (
    `<?xml version="1.0"?>` +
    `<PidOptions ver="1.0">` +
    `<Opts fCount="1" fType="2" iCount="0" pCount="0" pgCount="2" format="0" ` +
    `pidVer="2.0" timeout="20000" posh="UNKNOWN" env="P"${wadhAttr} />` +
    `<CustOpts><Param name="mantrakey" value="" /></CustOpts>` +
    `</PidOptions>`
  );
}

export function isBiometricSupported(): boolean {
  return Platform.OS === 'android';
}

/**
 * Launch the Mantra RD service to capture a fingerprint and return the parsed
 * PID fields. `wadh` comes from the AEPS login-status response.
 */
export async function captureFingerprint(wadh = ''): Promise<BiometricFields> {
  if (Platform.OS !== 'android') {
    throw new BiometricError('AEPS biometric capture is available on Android only.', 'IOS_UNSUPPORTED');
  }

  const pidOptions = buildPidOptions(wadh);
  let result: IntentLauncher.IntentLauncherResult;
  try {
    result = await IntentLauncher.startActivityAsync(RD_CAPTURE_ACTION, {
      extra: { PID_OPTIONS: pidOptions },
    });
  } catch (e: any) {
    throw new BiometricError(
      'Mantra RD Service not found. Install "Mantra RD Service" from Play Store and register the device.',
      'RD_NOT_INSTALLED'
    );
  }

  // resultCode: -1 = RESULT_OK, 0 = RESULT_CANCELED
  if (result.resultCode !== -1) {
    throw new BiometricError('Fingerprint capture was cancelled.', 'CANCELLED');
  }

  const pidXml = (result.extra as any)?.PID_DATA ?? (result.extra as any)?.response ?? result.data ?? '';
  if (!pidXml || typeof pidXml !== 'string') {
    throw new BiometricError('No biometric response from device. Please retry.', 'NO_RESPONSE');
  }
  return parsePidData(pidXml);
}
