import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserServer } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

// Ensure this route uses Node.js runtime (not Edge) for proper form data handling
export const runtime = 'nodejs'

// Helper to get Supabase client safely
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  // Enhanced diagnostics for AWS Amplify
  console.log('[Upload Document] Environment check:')
  console.log('[Upload Document] NEXT_PUBLIC_SUPABASE_URL exists:', !!supabaseUrl)
  console.log('[Upload Document] NEXT_PUBLIC_SUPABASE_URL length:', supabaseUrl?.length || 0)
  console.log('[Upload Document] SUPABASE_SERVICE_ROLE_KEY exists:', !!supabaseServiceKey)
  console.log('[Upload Document] SUPABASE_SERVICE_ROLE_KEY length:', supabaseServiceKey?.length || 0)
  console.log('[Upload Document] SUPABASE_SERVICE_ROLE_KEY type:', typeof supabaseServiceKey)
  console.log('[Upload Document] SUPABASE_SERVICE_ROLE_KEY is empty string:', supabaseServiceKey === '')
  console.log('[Upload Document] SUPABASE_SERVICE_ROLE_KEY after trim:', supabaseServiceKey?.trim()?.length || 0)
  
  // Check all env vars that contain SUPABASE
  const allSupabaseVars = Object.keys(process.env).filter(key => key.includes('SUPABASE'))
  console.log('[Upload Document] All SUPABASE env vars:', allSupabaseVars)

  if (!supabaseUrl) {
    const error = new Error('NEXT_PUBLIC_SUPABASE_URL is missing')
    console.error('[Upload Document] Error:', error.message)
    throw error
  }

  // More detailed validation
  if (!supabaseServiceKey) {
    const error = new Error('SUPABASE_SERVICE_ROLE_KEY is missing (undefined or null)')
    console.error('[Upload Document] Error:', error.message)
    console.error('[Upload Document] Available env vars with SUPABASE:', allSupabaseVars)
    throw error
  }

  if (supabaseServiceKey.trim() === '') {
    const error = new Error('SUPABASE_SERVICE_ROLE_KEY is empty string')
    console.error('[Upload Document] Error:', error.message)
    throw error
  }

  if (supabaseServiceKey === 'your_supabase_service_role_key') {
    const error = new Error('SUPABASE_SERVICE_ROLE_KEY is set to placeholder value')
    console.error('[Upload Document] Error:', error.message)
    throw error
  }

  // Additional check: JWT tokens should start with 'eyJ'
  if (!supabaseServiceKey.startsWith('eyJ')) {
    console.warn('[Upload Document] Warning: SUPABASE_SERVICE_ROLE_KEY does not start with "eyJ" (expected JWT format)')
    // Don't throw here, as it might still be valid, just log a warning
  }

  return createClient(supabaseUrl, supabaseServiceKey)
}

/**
 * Upload document to Supabase Storage
 * 
 * Authorization:
 * - Admin, Master Distributor, or Distributor access required
 * - Used for partner onboarding document uploads
 */
async function handleUploadDocument(request: NextRequest) {
  let supabaseAdmin
  try {
    supabaseAdmin = getSupabaseClient()
  } catch (clientError: any) {
    console.error('[Upload Document API] Failed to initialize Supabase client:', clientError)
    throw clientError // Re-throw to be caught by outer handler
  }
  
  try {
    // Log request headers for debugging
    const contentType = request.headers.get('content-type')
    console.log('[Upload Document API] Request Content-Type:', contentType)
    
    // Check if Content-Type is correct
    if (!contentType || (!contentType.includes('multipart/form-data') && !contentType.includes('application/x-www-form-urlencoded'))) {
      console.error('[Upload Document API] Invalid Content-Type:', contentType)
      return NextResponse.json(
        { 
          error: 'Invalid Content-Type. Expected multipart/form-data',
          received: contentType || 'not set'
        },
        { status: 400 }
      )
    }
    
    // Check authentication with timeout
    const authPromise = getCurrentUserServer()
    const authTimeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Authentication timeout')), 10000)
    )
    
    let user
    try {
      user = await Promise.race([authPromise, authTimeoutPromise]) as any
    } catch (authError: any) {
      console.error('[Upload Document API] Authentication error or timeout:', authError)
      return NextResponse.json(
        { error: 'Authentication failed or timed out. Please try again.' },
        { status: 401 }
      )
    }

    // Allow admin, master_distributor, and distributor roles
    if (!user || !['admin', 'master_distributor', 'distributor'].includes(user.role)) {
      return NextResponse.json(
        { error: 'Unauthorized: Admin, Master Distributor, or Distributor access required' },
        { status: 401 }
      )
    }

    // Parse form data
    let formData: FormData
    try {
      formData = await request.formData()
      console.log('[Upload Document API] FormData parsed successfully')
    } catch (formDataError: any) {
      console.error('[Upload Document API] Error parsing FormData:', formDataError)
      return NextResponse.json(
        { 
          error: 'Failed to parse form data',
          message: formDataError?.message || 'Invalid form data format',
          contentType: contentType
        },
        { status: 400 }
      )
    }
    
    const file = formData.get('file') as File
    const documentType = formData.get('documentType') as string // 'aadhar', 'pan', 'udhyam', 'gst', 'bank'
    const partnerId = formData.get('partnerId') as string // Optional, for existing partners

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    if (!documentType || !['aadhar', 'aadhar-front', 'aadhar-back', 'pan', 'udhyam', 'gst', 'bank'].includes(documentType)) {
      return NextResponse.json(
        { error: 'Invalid document type' },
        { status: 400 }
      )
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024 // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'File size exceeds 10MB limit' },
        { status: 400 }
      )
    }

    // Validate file type (images and PDFs)
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only images (JPEG, PNG, WebP) and PDFs are allowed' },
        { status: 400 }
      )
    }

    // Generate unique filename
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(2, 15)
    const fileExt = file.name.split('.').pop() || 'pdf'
    const fileName = `${documentType}/${timestamp}_${randomStr}.${fileExt}`

    // Convert File to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload to Supabase Storage
    // Create bucket if it doesn't exist (this will be done manually in Supabase dashboard)
    const bucketName = 'partner-documents'
    
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from(bucketName)
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false, // Don't overwrite existing files
      })

    if (uploadError) {
      console.error('[Upload Document API] Upload error:', uploadError)
      
      // Provide helpful error message for bucket not found
      const errorMessage = uploadError.message || ''
      const errorAny = uploadError as any
      const isBucketNotFound = errorMessage.includes('Bucket not found') || 
                               (errorMessage.includes('bucket') && errorMessage.includes('not found')) ||
                               errorAny.statusCode === '404' ||
                               errorAny.status === 404 ||
                               errorAny.statusCode === 404
      
      if (isBucketNotFound) {
        return NextResponse.json(
          { 
            error: 'Storage bucket not found. Please create the "partner-documents" bucket in Supabase Storage. See SUPABASE-STORAGE-BUCKET-SETUP.md for instructions.',
            details: 'The partner-documents bucket needs to be created in your Supabase project before uploading documents.'
          },
          { status: 500 }
        )
      }
      
      return NextResponse.json(
        { error: `Failed to upload file: ${errorMessage}` },
        { status: 500 }
      )
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from(bucketName)
      .getPublicUrl(fileName)

    return NextResponse.json({
      success: true,
      url: urlData.publicUrl,
      fileName: fileName,
    })
  } catch (error: any) {
    console.error('[Upload Document API] Error:', error)
    return NextResponse.json(
      { 
        error: 'Failed to upload document',
        message: error?.message || 'An error occurred while uploading the document'
      },
      { status: 500 }
    )
  }
}

// Export handler directly (not wrapped) to avoid Content-Type issues with form data
// The apiHandler tries to set JSON Content-Type which interferes with multipart/form-data
export async function POST(request: NextRequest) {
  try {
    return await handleUploadDocument(request)
  } catch (error: any) {
    console.error('[Upload Document API] Unhandled error:', error)
    console.error('[Upload Document API] Error stack:', error?.stack)
    
    // Check for specific error types and provide helpful messages
    const errorMessage = error?.message || ''
    
    // Environment variable errors
    if (errorMessage.includes('NEXT_PUBLIC_SUPABASE_URL') || errorMessage.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      return NextResponse.json(
        {
          error: 'Configuration error',
          message: 'Supabase environment variables are not configured correctly. Please check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
          details: errorMessage
        },
        { status: 500 }
      )
    }
    
    // Authentication errors
    if (errorMessage.includes('Authentication') || errorMessage.includes('auth') || errorMessage.includes('timeout')) {
      return NextResponse.json(
        {
          error: 'Authentication error',
          message: 'Failed to authenticate request. Please try logging in again.',
          details: errorMessage
        },
        { status: 401 }
      )
    }
    
    // Storage bucket errors
    if (errorMessage.includes('bucket') || errorMessage.includes('storage') || errorMessage.includes('Bucket not found')) {
      return NextResponse.json(
        {
          error: 'Storage configuration error',
          message: 'The storage bucket "partner-documents" may not be configured. Please create it in Supabase Storage.',
          details: errorMessage
        },
        { status: 500 }
      )
    }
    
    // Generic error with more details
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: errorMessage || 'An unexpected error occurred while uploading the document',
        ...(process.env.NODE_ENV === 'development' && {
          stack: error?.stack,
          details: error
        })
      },
      { status: 500 }
    )
  }
}

