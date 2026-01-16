# Onboarding Document Fields Implementation

## Overview
Added mandatory and optional document fields to the partner onboarding process (retailers, distributors, master distributors).

## New Fields Added

### Mandatory Fields:
1. **AADHAR Number** - 12-digit AADHAR number
2. **AADHAR Attachment** - Document file (image or PDF)
3. **PAN Number** - 10-character PAN number
4. **PAN Attachment** - Document file (image or PDF)

### Optional Fields (at least one required):
1. **UDHYAM Number** - UDHYAM registration number
2. **UDHYAM Certificate** - Certificate file (image or PDF)
3. **GST Number** - GST registration number (already existed, now with attachment)
4. **GST Certificate** - Certificate file (image or PDF)

## Validation Rules
- AADHAR Number and Attachment: **Mandatory**
- PAN Number and Attachment: **Mandatory**
- Either UDHYAM (with certificate) OR GST (with certificate) must be provided
- File size limit: 10MB per file
- Allowed file types: JPEG, PNG, WebP, PDF

## Database Migration

**IMPORTANT**: Run the migration file before deploying:
```sql
-- File: supabase-migration-add-document-fields.sql
```

This migration adds the following columns to all three partner tables:
- `aadhar_number` (TEXT)
- `aadhar_attachment_url` (TEXT)
- `pan_number` (TEXT)
- `pan_attachment_url` (TEXT)
- `udhyam_number` (TEXT)
- `udhyam_certificate_url` (TEXT)
- `gst_certificate_url` (TEXT)

## Supabase Storage Setup

**IMPORTANT**: Create a storage bucket named `partner-documents` in Supabase:

1. Go to Supabase Dashboard → Storage
2. Create a new bucket named `partner-documents`
3. Set it to **Public** (or configure RLS policies as needed)
4. Configure CORS if needed for direct uploads

## API Endpoints

### Upload Document
- **Endpoint**: `/api/admin/upload-document`
- **Method**: POST
- **Content-Type**: multipart/form-data
- **Parameters**:
  - `file`: File to upload
  - `documentType`: 'aadhar' | 'pan' | 'udhyam' | 'gst'
  - `partnerId`: Optional, for existing partners
- **Response**: JSON with `url` and `fileName`

### Create User (Updated)
- **Endpoint**: `/api/admin/create-user`
- **Method**: POST
- **Body**: JSON with `userData` containing document fields
- **Note**: Files should be uploaded separately before calling this endpoint

## Frontend Changes

### Form Fields Added
- AADHAR Number input
- AADHAR Attachment file input
- PAN Number input
- PAN Attachment file input
- UDHYAM Number input
- UDHYAM Certificate file input
- GST Certificate file input (GST number already existed)

### Validation
- Client-side validation ensures mandatory fields are filled
- Validates that at least one of UDHYAM or GST is provided
- File type and size validation

### File Upload Flow
1. User fills form and selects files
2. On submit, files are uploaded first (in sequence)
3. After all files are uploaded, partner data (with URLs) is sent to create-user API
4. If any upload fails, the process stops and shows an error

## Error Handling

### Server Error Fix
The "Server error" issue has been addressed by:
1. Adding timeout handling to all database operations
2. Adding content-type checking before JSON parsing
3. Improved error messages and logging
4. Better error handling for file uploads

### Common Issues

1. **"Failed to upload file"**
   - Check if `partner-documents` bucket exists in Supabase
   - Check bucket permissions
   - Verify file size is under 10MB

2. **"Database query timed out"**
   - The database may be slow or overloaded
   - Try again with a smaller page size
   - Check database connection

3. **"Column does not exist"**
   - Run the database migration: `supabase-migration-add-document-fields.sql`
   - Verify all columns were added successfully

## Testing Checklist

- [ ] Run database migration
- [ ] Create `partner-documents` storage bucket
- [ ] Test creating a retailer with all documents
- [ ] Test creating a distributor with all documents
- [ ] Test creating a master distributor with all documents
- [ ] Verify validation: AADHAR and PAN are mandatory
- [ ] Verify validation: At least one of UDHYAM or GST is required
- [ ] Test file upload with different file types (JPEG, PNG, PDF)
- [ ] Test file size limit (should reject files > 10MB)
- [ ] Test editing existing partner (should show existing documents)
- [ ] Verify documents are accessible via URLs

## Deployment Notes

1. **Before deploying**:
   - Run the database migration
   - Create the storage bucket
   - Test file uploads locally

2. **After deploying**:
   - Verify storage bucket is accessible
   - Test creating a new partner
   - Check CloudFront/Amplify configuration if needed

3. **If server errors persist**:
   - Check browser console for specific error messages
   - Check server logs for detailed error information
   - Verify all environment variables are set correctly
   - Ensure Supabase service role key has proper permissions

