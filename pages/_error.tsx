import { NextPageContext } from 'next'

interface ErrorProps {
  statusCode?: number
}

function Error({ statusCode }: ErrorProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center' }}>
        {statusCode && (
          <h1 style={{ fontSize: '3rem', fontWeight: 700, color: '#111', margin: 0 }}>{statusCode}</h1>
        )}
        <p style={{ fontSize: '1.125rem', color: '#666', marginTop: '0.5rem' }}>
          {statusCode === 404
            ? 'This page could not be found.'
            : 'An unexpected error occurred.'}
        </p>
      </div>
    </div>
  )
}

Error.getInitialProps = ({ res, err }: NextPageContext) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404
  return { statusCode }
}

export default Error
