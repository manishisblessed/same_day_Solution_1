import { NextRequest, NextResponse } from 'next/server'
import nodemailer, { Transporter } from 'nodemailer'
import SMTPTransport from 'nodemailer/lib/smtp-transport'

// Helper function to escape HTML and prevent XSS
function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, email, phone, message } = body

    // Validate required fields
    if (!name || !email || !phone || !message) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Validate SMTP configuration
    if (!process.env.SMTP_PASSWORD) {
      console.error('SMTP_PASSWORD is not set in environment variables')
      return NextResponse.json(
        { error: 'Email service is not configured. Please contact the administrator.' },
        { status: 500 }
      )
    }

    // Create transporter using environment variables
    // Default settings are for Titan Mail (GoDaddy)
    const smtpHost = process.env.SMTP_HOST || 'smtpout.secureserver.net'
    const smtpPort = parseInt(process.env.SMTP_PORT || '465')
    const smtpSecure = process.env.SMTP_SECURE === 'true' || (process.env.SMTP_SECURE === undefined && smtpPort === 465)
    
    const transporter: Transporter<SMTPTransport.SentMessageInfo> = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure, // true for SSL (port 465), false for TLS (port 587)
      auth: {
        user: process.env.SMTP_USER || 'info@samedaysolution.in',
        pass: process.env.SMTP_PASSWORD,
      },
      // Additional options for Titan Mail compatibility
      tls: {
        rejectUnauthorized: false, // Some SMTP servers require this
      },
      // Reasonable timeout settings for reliable email delivery
      connectionTimeout: 10000, // 10 seconds max for connection
      greetingTimeout: 5000, // 5 seconds max for greeting
      socketTimeout: 5000, // 5 seconds max for socket operations
      // Don't wait for connection to close
      pool: false,
    } as SMTPTransport.Options)

    // Escape user input to prevent XSS attacks
    const safeName = escapeHtml(name.trim())
    const safeEmail = escapeHtml(email.trim())
    const safePhone = escapeHtml(phone.trim())
    const safeMessage = escapeHtml(message.trim()).replace(/\n/g, '<br>')

    // Email content
    const mailOptions = {
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'info@samedaysolution.in',
      to: 'info@samedaysolution.in',
      replyTo: email, // Allow replying directly to the sender
      subject: `New Contact Form Submission from ${safeName}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; border-bottom: 2px solid #4F46E5; padding-bottom: 10px;">
            New Contact Form Submission
          </h2>
          <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; margin-top: 20px;">
            <p style="margin: 10px 0;"><strong>Name:</strong> ${safeName}</p>
            <p style="margin: 10px 0;"><strong>Email:</strong> ${safeEmail}</p>
            <p style="margin: 10px 0;"><strong>Phone:</strong> ${safePhone}</p>
            <p style="margin: 10px 0;"><strong>Message:</strong></p>
            <p style="margin: 10px 0; padding: 15px; background-color: white; border-left: 4px solid #4F46E5; border-radius: 4px;">
              ${safeMessage}
            </p>
          </div>
          <p style="margin-top: 20px; color: #666; font-size: 12px;">
            This email was sent from the contact form on Same Day Solution website.
          </p>
        </div>
      `,
      text: `
        New Contact Form Submission
        
        Name: ${name.trim()}
        Email: ${email.trim()}
        Phone: ${phone.trim()}
        Message: ${message.trim()}
      `,
    }

    // Send email - ensure it completes before responding
    const info = await transporter.sendMail(mailOptions)
    console.log('Email sent successfully:', info.messageId)

    return NextResponse.json(
      { message: 'Email sent successfully' },
      { status: 200 }
    )
  } catch (error: any) {
    console.error('Error sending email:', error)
    
    // Provide more specific error messages
    let errorMessage = 'Failed to send email. Please try again later.'
    if (error.code === 'EAUTH') {
      errorMessage = 'Email authentication failed. Please check your SMTP credentials.'
    } else if (error.code === 'ECONNECTION') {
      errorMessage = 'Could not connect to email server. Please check your SMTP settings.'
    } else if (error.responseCode) {
      errorMessage = `Email server error: ${error.response}`
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}

