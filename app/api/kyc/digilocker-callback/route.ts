import { NextRequest, NextResponse } from 'next/server'
import { getDigilockerDocument, generateOrderId } from '@/services/ekyc'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const verification_id = searchParams.get('verification_id') || searchParams.get('id') || ''
  const reference_id = searchParams.get('reference_id') || ''
  const code = searchParams.get('code') || ''

  console.log('[Digilocker Callback] verification_id:', verification_id, 'reference_id:', reference_id, 'code:', code)
  console.log('[Digilocker Callback] All params:', Object.fromEntries(searchParams.entries()))

  if (!verification_id) {
    return renderPage({
      success: false,
      error: 'No verification ID received from Digilocker',
    })
  }

  try {
    const orderid = generateOrderId('DIGI_CB')
    const result = await getDigilockerDocument(
      verification_id,
      reference_id || verification_id,
      orderid,
      'AADHAAR'
    )

    console.log('[Digilocker Callback] Document result:', JSON.stringify(result))

    if (result.status === 'Failure') {
      return renderPage({
        success: false,
        error: result.message || 'Failed to fetch Aadhaar data from Digilocker',
      })
    }

    return renderPage({
      success: true,
      data: {
        name: result.name || '',
        uid: result.uid || '',
        dob: result.dob || '',
        gender: result.gender || '',
        address: result.address || '',
        care_of: result.care_of || '',
        verification_id,
      },
    })
  } catch (error: any) {
    console.error('[Digilocker Callback] Error:', error)
    return renderPage({
      success: false,
      error: error.message || 'Failed to process Digilocker verification',
    })
  }
}

function renderPage(result: { success: boolean; data?: any; error?: string }) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Digilocker Verification</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8fafc; }
    .card { background: white; border-radius: 16px; padding: 40px; max-width: 480px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,0.08); text-align: center; }
    .icon { width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 32px; }
    .icon.success { background: #dcfce7; }
    .icon.error { background: #fee2e2; }
    h2 { font-size: 20px; margin-bottom: 8px; color: #1e293b; }
    p { color: #64748b; font-size: 14px; margin-bottom: 16px; }
    .detail { text-align: left; background: #f1f5f9; border-radius: 8px; padding: 16px; margin-top: 16px; }
    .detail-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: #64748b; font-weight: 500; }
    .detail-value { color: #1e293b; font-weight: 600; text-align: right; max-width: 60%; word-break: break-all; }
    .closing { margin-top: 20px; color: #94a3b8; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    ${result.success ? `
      <div class="icon success">✓</div>
      <h2>Aadhaar Verified Successfully</h2>
      <p>Your Aadhaar details have been fetched from Digilocker.</p>
      ${result.data ? `<div class="detail">
        ${result.data.name ? `<div class="detail-row"><span class="detail-label">Name</span><span class="detail-value">${result.data.name}</span></div>` : ''}
        ${result.data.uid ? `<div class="detail-row"><span class="detail-label">UID</span><span class="detail-value">${result.data.uid}</span></div>` : ''}
        ${result.data.dob ? `<div class="detail-row"><span class="detail-label">Date of Birth</span><span class="detail-value">${result.data.dob}</span></div>` : ''}
        ${result.data.gender ? `<div class="detail-row"><span class="detail-label">Gender</span><span class="detail-value">${result.data.gender}</span></div>` : ''}
        ${result.data.address ? `<div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${result.data.address}</span></div>` : ''}
      </div>` : ''}
      <p class="closing">This window will close automatically...</p>
    ` : `
      <div class="icon error">✗</div>
      <h2>Verification Issue</h2>
      <p>${result.error || 'Something went wrong during Digilocker verification.'}</p>
      <p class="closing">This window will close automatically...</p>
    `}
  </div>
  <script>
    const result = ${JSON.stringify(result)};
    
    // Send data back to opener via postMessage
    if (window.opener) {
      window.opener.postMessage({ type: 'DIGILOCKER_RESULT', ...result }, '*');
    }
    
    // Also store in localStorage for cross-tab communication
    try {
      localStorage.setItem('digilocker_result', JSON.stringify({ ...result, timestamp: Date.now() }));
    } catch(e) {}
    
    // Auto-close after 3 seconds
    setTimeout(() => { window.close(); }, 3000);
  </script>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  })
}
