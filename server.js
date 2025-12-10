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
const licenses = new Map();
const payments = new Map();

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
    version: '2.2.0'
  });
});

// ============================================
// PAYMENT SUCCESS PAGE - XỬ LÝ RETURN URL
// ============================================
app.get('/api/payment-success', (req, res) => {
  // Lấy query params từ PayOS return URL
  const { code, status, orderCode, id, cancel } = req.query;
  
  console.log('🔔 ========== PAYMENT RETURN ==========');
  console.log('Code:', code);
  console.log('Status:', status);
  console.log('OrderCode:', orderCode);
  console.log('Cancel:', cancel);
  
  // Kiểm tra thanh toán thành công
  // code=00 và status=PAID nghĩa là thành công
  if (code === '00' && status === 'PAID' && orderCode) {
    console.log('✅ Payment SUCCESS!');
    
    // Tìm hoặc tạo payment record
    let payment = payments.get(orderCode.toString());
    
    if (!payment) {
      payment = {
        orderId: orderCode,
        status: 'pending',
        createdAt: new Date().toISOString(),
        licenseKey: null
      };
    }
    
    // Tạo license nếu chưa có
    if (payment.status !== 'completed') {
      const licenseKey = generateLicenseKey();
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      
      // Lưu license
      licenses.set(licenseKey, {
        key: licenseKey,
        orderId: orderCode,
        status: 'active',
        createdAt: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        deviceId: null
      });
      
      // Update payment
      payment.status = 'completed';
      payment.licenseKey = licenseKey;
      payment.completedAt = new Date().toISOString();
      payments.set(orderCode.toString(), payment);
      
      console.log(`🔑 License created: ${licenseKey}`);
    }
  }
  
  // Hiển thị trang kết quả
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
            .highlight { font-weight: 600; color: #333; }
            .note { font-size: 14px; color: #888; margin-top: 24px; padding-top: 20px; border-top: 1px solid #eee; }
            .close-btn {
                margin-top: 24px;
                padding: 14px 40px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                border-radius: 12px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
            }
            .order-code { 
                background: #f3f4f6; 
                padding: 10px 20px; 
                border-radius: 8px; 
                font-family: monospace;
                margin: 16px 0;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon">${isSuccess ? '✅' : (isCancelled ? '❌' : '⏳')}</div>
            <h1>${isSuccess ? 'Thanh toán thành công!' : (isCancelled ? 'Đã hủy thanh toán' : 'Đang xử lý...')}</h1>
            ${isSuccess ? `
                <p>Cảm ơn bạn đã nâng cấp <span class="highlight">Premium</span>.</p>
                <div class="order-code">Mã đơn: ${orderCode}</div>
                <p class="highlight">Bạn có thể đóng tab này.</p>
                <p class="note">Extension sẽ tự động kích hoạt Premium trong vài giây.</p>
            ` : (isCancelled ? `
                <p>Bạn đã hủy thanh toán.</p>
                <p>Vui lòng thử lại nếu muốn nâng cấp Premium.</p>
            ` : `
                <p>Đang xử lý thanh toán của bạn...</p>
            `)}
            <button class="close-btn" onclick="window.close()">Đóng tab này</button>
        </div>
    </body>
    </html>
  `);
});

// ============================================
// CREATE PAYMENT LINK
// ============================================
app.post('/api/create-payment', async (req, res) => {
  try {
    console.log('📥 Create payment:', req.body);
    
    const { productName, price, returnUrl, cancelUrl } = req.body;
    
    if (!productName || !price) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin'
      });
    }
    
    const orderCode = Date.now();
    
    // Return URL về backend để xử lý
    const backendReturnUrl = `https://packing-backend-pndo.onrender.com/api/payment-success`;
    
    const paymentData = {
      orderCode: orderCode,
      amount: price,
      description: productName.substring(0, 25),
      returnUrl: backendReturnUrl,
      cancelUrl: backendReturnUrl,
      signature: ''
    };
    
    // Generate signature
    const signatureData = {
      amount: paymentData.amount,
      cancelUrl: paymentData.cancelUrl,
      description: paymentData.description,
      orderCode: paymentData.orderCode,
      returnUrl: paymentData.returnUrl
    };
    paymentData.signature = generateSignature(signatureData);
    
    // Call PayOS API
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
    
    console.log('✅ PayOS response:', payosResponse.data);
    
    // Store payment
    payments.set(orderCode.toString(), {
      orderId: orderCode,
      status: 'pending',
      amount: price,
      productName: productName,
      createdAt: new Date().toISOString(),
      licenseKey: null
    });
    
    res.json({
      success: true,
      checkoutUrl: payosResponse.data.data.checkoutUrl,
      orderId: orderCode,
      message: 'OK'
    });
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || error.message
    });
  }
});

// ============================================
// PAYOS WEBHOOK (POST)
// ============================================
app.post('/api/payos-webhook', async (req, res) => {
  try {
    console.log('🔔 Webhook received:', JSON.stringify(req.body, null, 2));
    
    const { code, success, data } = req.body;
    
    if (code === '00' && success === true && data) {
      const orderCode = data.orderCode?.toString();
      
      console.log(`✅ Webhook: Payment SUCCESS for order ${orderCode}`);
      
      let payment = payments.get(orderCode);
      
      if (!payment) {
        payment = {
          orderId: orderCode,
          status: 'pending',
          amount: data.amount,
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
        payments.set(orderCode, payment);
        
        console.log(`🔑 License created via webhook: ${licenseKey}`);
      }
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.json({ success: true });
  }
});

// ============================================
// GET LICENSE BY ORDER ID
// ============================================
app.get('/api/get-license/:orderId', (req, res) => {
  const { orderId } = req.params;
  console.log('🔍 Get license:', orderId);
  
  const payment = payments.get(orderId);
  console.log('Payment:', payment);
  
  if (!payment) {
    return res.json({
      success: false,
      status: 'not_found',
      message: 'Đang chờ...'
    });
  }
  
  if (payment.status === 'pending') {
    return res.json({
      success: false,
      status: 'pending',
      message: 'Đang chờ thanh toán...'
    });
  }
  
  if (payment.status === 'completed' && payment.licenseKey) {
    const license = licenses.get(payment.licenseKey);
    
    return res.json({
      success: true,
      status: 'completed',
      licenseKey: payment.licenseKey,
      expiryDate: license?.expiryDate,
      message: 'OK'
    });
  }
  
  return res.json({
    success: false,
    status: 'unknown'
  });
});

// ============================================
// ACTIVATE LICENSE (Manual)
// ============================================
app.post('/api/activate-license', (req, res) => {
  const { licenseKey, deviceId } = req.body;
  
  if (!licenseKey) {
    return res.status(400).json({
      success: false,
      message: 'Vui lòng nhập mã kích hoạt'
    });
  }
  
  const trimmedKey = licenseKey.trim().toUpperCase();
  const license = licenses.get(trimmedKey);
  
  if (!license) {
    return res.status(404).json({
      success: false,
      message: 'Mã không hợp lệ'
    });
  }
  
  if (new Date(license.expiryDate) < new Date()) {
    return res.status(400).json({
      success: false,
      message: 'Mã đã hết hạn'
    });
  }
  
  if (license.status === 'used' && deviceId) {
    const hashedDeviceId = hashDeviceId(deviceId);
    if (license.deviceId && license.deviceId !== hashedDeviceId) {
      return res.status(400).json({
        success: false,
        message: 'Mã đã dùng trên thiết bị khác'
      });
    }
  }
  
  if (deviceId) {
    license.deviceId = hashDeviceId(deviceId);
  }
  license.status = 'used';
  license.activatedAt = new Date().toISOString();
  licenses.set(trimmedKey, license);
  
  res.json({
    success: true,
    message: 'OK',
    expiryDate: license.expiryDate
  });
});

// ============================================
// DEBUG
// ============================================
app.get('/api/admin/debug', (req, res) => {
  res.json({
    payments: Array.from(payments.entries()),
    licenses: Array.from(licenses.entries()),
    timestamp: new Date().toISOString()
  });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
