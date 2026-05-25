import { NextRequest, NextResponse } from 'next/server'

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

  return renderPage({
    success: true,
    data: { verification_id, reference_id: reference_id || verification_id, code },
    pending: true,
  })
}

function renderPage(result: { success: boolean; data?: any; error?: string; pending?: boolean }) {
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
    .icon.pending { background: #fef3c7; }
    .icon.error { background: #fee2e2; }
    h2 { font-size: 20px; margin-bottom: 8px; color: #1e293b; }
    p { color: #64748b; font-size: 14px; margin-bottom: 16px; }
    .closing { margin-top: 20px; color: #94a3b8; font-size: 13px; }
    .spinner { display: inline-block; width: 24px; height: 24px; border: 3px solid #e2e8f0; border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 12px auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    ${result.success && result.pending ? `
      <div class="icon pending">&#9888;</div>
      <h2>Digilocker Authorized</h2>
      <p>Fetching your Aadhaar details...</p>
      <div class="spinner"></div>
      <p class="closing">This window will close automatically...</p>
    ` : result.success ? `
      <div class="icon success">&#10003;</div>
      <h2>Aadhaar Verified Successfully</h2>
      <p>Your Aadhaar details have been fetched from Digilocker.</p>
      <p class="closing">This window will close automatically...</p>
    ` : `
      <div class="icon error">&#10007;</div>
      <h2>Verification Issue</h2>
      <p>${result.error || 'Something went wrong during Digilocker verification.'}</p>
      <p class="closing">This window will close automatically...</p>
    `}
  </div>
  <script>
    const callbackData = ${JSON.stringify(result)};
    
    if (callbackData.success && callbackData.pending && callbackData.data) {
      // Send pending signal so parent knows Digilocker auth succeeded
      const pendingResult = {
        type: 'DIGILOCKER_RESULT',
        success: true,
        pending: true,
        data: callbackData.data
      };
      if (window.opener) {
        window.opener.postMessage(pendingResult, '*');
      }
      try {
        localStorage.setItem('digilocker_result', JSON.stringify({ ...pendingResult, timestamp: Date.now() }));
      } catch(e) {}
      setTimeout(() => { window.close(); }, 2000);
    } else {
      const finalResult = { type: 'DIGILOCKER_RESULT', ...callbackData };
      if (window.opener) {
        window.opener.postMessage(finalResult, '*');
      }
      try {
        localStorage.setItem('digilocker_result', JSON.stringify({ ...finalResult, timestamp: Date.now() }));
      } catch(e) {}
      setTimeout(() => { window.close(); }, 3000);
    }
  </script>
</body>
</html>`

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  })
}
