import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCurrentUserServer } from '@/lib/auth-server'
import { apiHandler } from '@/lib/api-wrapper'

export const dynamic = 'force-dynamic'

// Helper to get Supabase client safely
function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase environment variables')
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
  const supabaseAdmin = getSupabaseClient()
  
  try {
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

    const formData = await request.formData()
    const file = formData.get('file') as File
    const documentType = formData.get('documentType') as string // 'aadhar', 'pan', 'udhyam', 'gst'
    const partnerId = formData.get('partnerId') as string // Optional, for existing partners

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      )
    }

    if (!documentType || !['aadhar', 'pan', 'udhyam', 'gst'].includes(documentType)) {
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

// Export wrapped handler
export const POST = apiHandler(handleUploadDocument)

