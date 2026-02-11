/**
 * AWS Lambda Function for T+1 Settlement Cron Job
 * 
 * This Lambda function is triggered by EventBridge (CloudWatch Events)
 * to run the T+1 settlement API endpoint daily.
 * 
 * Environment Variables Required:
 * - SETTLEMENT_CRON_API_KEY: API key for authentication
 * - API_URL: API endpoint URL (default: https://api.samedaysolution.in/api/settlement/run-t1)
 */

const https = require('https');

exports.handler = async (event) => {
    const apiKey = process.env.SETTLEMENT_CRON_API_KEY;
    const apiUrl = process.env.API_URL || 'https://api.samedaysolution.in/api/settlement/run-t1';
    
    console.log('T+1 Settlement Lambda triggered');
    console.log('API URL:', apiUrl);
    
    // Validate API key
    if (!apiKey) {
        const error = 'SETTLEMENT_CRON_API_KEY environment variable is not configured';
        console.error(error);
        throw new Error(error);
    }
    
    // Make API call
    return new Promise((resolve, reject) => {
        const url = new URL(apiUrl);
        
        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json',
                'User-Agent': 'AWS-Lambda-T1-Settlement/1.0'
            },
            timeout: 300000 // 5 minutes
        };
        
        console.log('Making API request to:', apiUrl);
        
        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                console.log('API Response Status:', res.statusCode);
                console.log('API Response Body:', data);
                
                let responseBody;
                try {
                    responseBody = JSON.parse(data);
                } catch (e) {
                    responseBody = { raw: data };
                }
                
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({
                        statusCode: 200,
                        body: JSON.stringify({
                            success: true,
                            message: 'T+1 settlement triggered successfully',
                            apiResponse: responseBody,
                            timestamp: new Date().toISOString()
                        })
                    });
                } else {
                    reject({
                        statusCode: res.statusCode,
                        body: JSON.stringify({
                            success: false,
                            error: 'API returned error status',
                            apiResponse: responseBody,
                            timestamp: new Date().toISOString()
                        })
                    });
                }
            });
        });
        
        req.on('error', (error) => {
            console.error('Request error:', error);
            reject({
                statusCode: 500,
                body: JSON.stringify({
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                })
            });
        });
        
        req.on('timeout', () => {
            console.error('Request timeout');
            req.destroy();
            reject({
                statusCode: 504,
                body: JSON.stringify({
                    success: false,
                    error: 'Request timeout',
                    timestamp: new Date().toISOString()
                })
            });
        });
        
        // Send request
        req.end();
    });
};

