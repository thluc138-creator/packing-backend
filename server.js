require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json());

// ============================================
// CONFIGURATION
// ============================================
const PAYOS_CONFIG = {
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY
};

const PORT = process.env.PORT || 3000;

// ============================================
// IN-MEMORY DATABASES
// ============================================
const licenses = new Map();      // licenseKey -> license data
const payments = new Map();      // orderId -> payment data
const deviceLicenses = new Map(); // deviceId -> licenseKey (để khôi phục khi cài lại)

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateLicenseKey() {
  const prefix = 'PACK';
  const random = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `${prefix}-${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8, 12)}-${random.slice(12, 16)}`;
}

function generateSignature(data) {
  const sortedKeys = Object.keys(data).sort();
  const signaturePayload = sortedKeys
    .map(key => `${key}=${data[key]}`)
    .join('&');
  
  return crypto
    .createHmac('sha256', PAYOS_CONFIG.checksumKey)
    .update(signaturePayload)
    .digest('hex');
}

function hashDeviceId(deviceId) {
  return crypto.createHash('sha256').update(deviceId).digest('hex');
}

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: '✅ Backend đang hoạt động',
    version: '3.0.0'
  });
});

// ============================================
// PAYMENT SUCCESS PAGE
// ============================================
app.get('/api/payment-success', (req, res) => {
  const { code, status, orderCode, cancel } = req.query;
  
  console.log('🔔 Payment return:', { code, status, orderCode, cancel });
  
  // Xử lý thanh toán thành công
  if (code === '00' && status === 'PAID' && orderCode) {
    let payment = payments.get(orderCode.toString());
    
    if (!payment) {
      payment = {
        orderId: orderCode,
        status: 'pending',
        createdAt: new Date().toISOString(),
        licenseKey: null
      };
    }
    
    if (payment.status !== 'completed') {
      const licenseKey = generateLicenseKey();
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      
      licenses.set(licenseKey, {
        key: licenseKey,
        orderId: orderCode,
        status: 'active',
        createdAt: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        deviceId: null
      });
      
      payment.status = 'completed';
      payment.licenseKey = licenseKey;
      payment.completedAt = new Date().toISOString();
      payments.set(orderCode.toString(), payment);
      
      console.log(`🔑 License created: ${licenseKey}`);
    }
  }
  
  const isSuccess = code === '00' && status === 'PAID';
  const isCancelled = cancel === 'true' || status === 'CANCELLED';
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>${isSuccess ? 'Thanh toán thành công' : 'Thanh toán'}</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; 
                text-align: center; 
                background: linear-gradient(135deg, ${isSuccess ? '#667eea' : '#ef4444'} 0%, ${isSuccess ? '#764ba2' : '#dc2626'} 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }
            .container {
                max-width: 450px;
                width: 100%;
                padding: 50px 40px;
                background: white;
                border-radius: 24px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            .icon { font-size: 80px; margin-bottom: 20px; }
            h1 { color: ${isSuccess ? '#10b981' : '#ef4444'}; margin-bottom: 16px; font-size: 28px; }
            p { font-size: 16px; margin-bottom: 12px; color: #555; line-height: 1.6; }
            .order-code { background: #f3f4f6; padding: 10px 20px; border-radius: 8px; font-family: monospace; margin: 16px 0; }
            .close-btn { margin-top: 24px; padding: 14px 40px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 12px; font-size: 16px; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon">${isSuccess ? '✅' : (isCancelled ? '❌' : '⏳')}</div>
            <h1>${isSuccess ? 'Thanh toán thành công!' : (isCancelled ? 'Đã hủy thanh toán' : 'Đang xử lý...')}</h1>
            ${isSuccess ? `
                <p>Cảm ơn bạn đã nâng cấp <strong>Premium</strong>.</p>
                <div class="order-code">Mã đơn: ${orderCode}</div>
                <p><strong>Bạn có thể đóng tab này.</strong></p>
                <p style="font-size: 14px; color: #888;">Extension sẽ tự động kích hoạt Premium.</p>
            ` : `<p>Vui lòng thử lại.</p>`}
            <button class="close-btn" onclick="window.close()">Đóng tab này</button>
        </div>
    </body>
    </html>
  `);
});

// ============================================
// CREATE PAYMENT
// ============================================
app.post('/api/create-payment', async (req, res) => {
  try {
    const { productName, price } = req.body;
    
    if (!productName || !price) {
      return res.status(400).json({ success: false, message: 'Missing info' });
    }
    
    const orderCode = Date.now();
    const backendReturnUrl = `https://packing-backend-pndo.onrender.com/api/payment-success`;
    
    const paymentData = {
      orderCode,
      amount: price,
      description: productName.substring(0, 25),
      returnUrl: backendReturnUrl,
      cancelUrl: backendReturnUrl,
      signature: ''
    };
    
    const signatureData = {
      amount: paymentData.amount,
      cancelUrl: paymentData.cancelUrl,
      description: paymentData.description,
      orderCode: paymentData.orderCode,
      returnUrl: paymentData.returnUrl
    };
    paymentData.signature = generateSignature(signatureData);
    
    const payosResponse = await axios.post(
      'https://api-merchant.payos.vn/v2/payment-requests',
      paymentData,
      {
        headers: {
          'x-client-id': PAYOS_CONFIG.clientId,
          'x-api-key': PAYOS_CONFIG.apiKey,
          'Content-Type': 'application/json'
        }
      }
    );
    
    payments.set(orderCode.toString(), {
      orderId: orderCode,
      status: 'pending',
      amount: price,
      createdAt: new Date().toISOString(),
      licenseKey: null
    });
    
    res.json({
      success: true,
      checkoutUrl: payosResponse.data.data.checkoutUrl,
      orderId: orderCode
    });
    
  } catch (error) {
    console.error('Payment error:', error.response?.data || error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// PAYOS WEBHOOK
// ============================================
app.post('/api/payos-webhook', (req, res) => {
  console.log('🔔 Webhook:', JSON.stringify(req.body, null, 2));
  
  const { code, success, data } = req.body;
  
  if (code === '00' && success === true && data) {
    const orderCode = data.orderCode?.toString();
    
    let payment = payments.get(orderCode);
    if (!payment) {
      payment = { orderId: orderCode, status: 'pending', createdAt: new Date().toISOString(), licenseKey: null };
    }
    
    if (payment.status !== 'completed') {
      const licenseKey = generateLicenseKey();
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      
      licenses.set(licenseKey, {
        key: licenseKey,
        orderId: orderCode,
        status: 'active',
        createdAt: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        deviceId: null
      });
      
      payment.status = 'completed';
      payment.licenseKey = licenseKey;
      payments.set(orderCode, payment);
      
      console.log(`🔑 License via webhook: ${licenseKey}`);
    }
  }
  
  res.json({ success: true });
});

// ============================================
// GET LICENSE BY ORDER ID
// ============================================
app.get('/api/get-license/:orderId', (req, res) => {
  const { orderId } = req.params;
  const payment = payments.get(orderId);
  
  if (!payment) {
    return res.json({ success: false, status: 'not_found' });
  }
  
  if (payment.status === 'completed' && payment.licenseKey) {
    const license = licenses.get(payment.licenseKey);
    return res.json({
      success: true,
      status: 'completed',
      licenseKey: payment.licenseKey,
      expiryDate: license?.expiryDate
    });
  }
  
  res.json({ success: false, status: payment.status });
});

// ============================================
// BIND DEVICE TO LICENSE (Sau khi thanh toán thành công)
// ============================================
app.post('/api/bind-device', (req, res) => {
  const { licenseKey, deviceId } = req.body;
  
  if (!licenseKey || !deviceId) {
    return res.status(400).json({ success: false, message: 'Missing data' });
  }
  
  const license = licenses.get(licenseKey);
  if (!license) {
    return res.status(404).json({ success: false, message: 'License not found' });
  }
  
  // Hash device ID
  const hashedDeviceId = hashDeviceId(deviceId);
  
  // Bind device to license
  license.deviceId = hashedDeviceId;
  licenses.set(licenseKey, license);
  
  // Lưu mapping deviceId -> licenseKey để khôi phục khi cài lại
  deviceLicenses.set(hashedDeviceId, licenseKey);
  
  console.log(`🔗 Device bound: ${hashedDeviceId.substring(0, 16)}... -> ${licenseKey}`);
  
  res.json({ success: true, message: 'Device bound' });
});

// ============================================
// CHECK DEVICE LICENSE (Khôi phục khi cài lại extension)
// ============================================
app.post('/api/check-device-license', (req, res) => {
  const { deviceId } = req.body;
  
  if (!deviceId) {
    return res.json({ success: false, valid: false, message: 'No device ID' });
  }
  
  const hashedDeviceId = hashDeviceId(deviceId);
  const licenseKey = deviceLicenses.get(hashedDeviceId);
  
  if (!licenseKey) {
    return res.json({ success: false, valid: false, message: 'No license for this device' });
  }
  
  const license = licenses.get(licenseKey);
  
  if (!license) {
    return res.json({ success: false, valid: false, message: 'License not found' });
  }
  
  // Check expiry
  if (new Date(license.expiryDate) < new Date()) {
    return res.json({ success: false, valid: false, message: 'License expired' });
  }
  
  console.log(`✅ License restored for device: ${hashedDeviceId.substring(0, 16)}...`);
  
  res.json({
    success: true,
    valid: true,
    licenseKey: licenseKey,
    expiryDate: license.expiryDate,
    message: 'License valid'
  });
});

// ============================================
// ACTIVATE LICENSE (Manual key input)
// ============================================
app.post('/api/activate-license', (req, res) => {
  const { licenseKey, deviceId } = req.body;
  
  if (!licenseKey) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập mã' });
  }
  
  const trimmedKey = licenseKey.trim().toUpperCase();
  const license = licenses.get(trimmedKey);
  
  if (!license) {
    return res.status(404).json({ success: false, message: 'Mã không hợp lệ' });
  }
  
  if (new Date(license.expiryDate) < new Date()) {
    return res.status(400).json({ success: false, message: 'Mã đã hết hạn' });
  }
  
  // Bind device if provided
  if (deviceId) {
    const hashedDeviceId = hashDeviceId(deviceId);
    
    // Check if already bound to different device
    if (license.deviceId && license.deviceId !== hashedDeviceId) {
      return res.status(400).json({ success: false, message: 'Mã đã dùng trên thiết bị khác' });
    }
    
    license.deviceId = hashedDeviceId;
    deviceLicenses.set(hashedDeviceId, trimmedKey);
  }
  
  license.status = 'used';
  license.activatedAt = new Date().toISOString();
  licenses.set(trimmedKey, license);
  
  res.json({ success: true, expiryDate: license.expiryDate });
});

// ============================================
// DEBUG
// ============================================
app.get('/api/admin/debug', (req, res) => {
  res.json({
    payments: Array.from(payments.entries()),
    licenses: Array.from(licenses.entries()).map(([k, v]) => ({
      key: k,
      ...v,
      deviceId: v.deviceId ? v.deviceId.substring(0, 16) + '...' : null
    })),
    deviceBindings: Array.from(deviceLicenses.entries()).map(([k, v]) => ({
      deviceId: k.substring(0, 16) + '...',
      licenseKey: v
    })),
    timestamp: new Date().toISOString()
  });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('📝 Endpoints:');
  console.log('   POST /api/create-payment');
  console.log('   POST /api/payos-webhook');
  console.log('   GET  /api/get-license/:orderId');
  console.log('   POST /api/bind-device');
  console.log('   POST /api/check-device-license');
  console.log('   POST /api/activate-license');
  console.log('   GET  /api/payment-success');
  console.log('   GET  /api/admin/debug');
});
