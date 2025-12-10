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

// Rate limiting middleware
const requestCounts = new Map();
const RATE_LIMIT = 100;
const RATE_WINDOW = 60 * 60 * 1000;

function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return next();
  }
  
  const record = requestCounts.get(ip);
  
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + RATE_WINDOW;
    return next();
  }
  
  if (record.count >= RATE_LIMIT) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests. Please try again later.'
    });
  }
  
  record.count++;
  next();
}

app.use('/api/activate-license', rateLimitMiddleware);
app.use('/api/check-license', rateLimitMiddleware);

// ============================================
// CONFIGURATION
// ============================================
const PAYOS_CONFIG = {
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY
};

const PORT = process.env.PORT || 3000;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-secret-encryption-key-32-chars!!';

// ============================================
// IN-MEMORY DATABASES
// ============================================
const licenses = new Map();
const payments = new Map();
const activationAttempts = new Map();

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

function checkActivationAttempts(ip) {
  const now = Date.now();
  
  if (!activationAttempts.has(ip)) {
    activationAttempts.set(ip, { count: 1, resetTime: now + 3600000 });
    return true;
  }
  
  const record = activationAttempts.get(ip);
  
  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + 3600000;
    return true;
  }
  
  if (record.count >= 10) {
    return false;
  }
  
  record.count++;
  return true;
}

// ============================================
// ROUTES
// ============================================

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: '✅ Backend đang hoạt động',
    version: '2.1.0',
    endpoints: {
      createPayment: 'POST /api/create-payment',
      webhook: 'POST /api/payos-webhook',
      getLicense: 'GET /api/get-license/:orderId',
      paymentSuccess: 'GET /api/payment-success'
    }
  });
});

// ============================================
// PAYMENT SUCCESS PAGE
// ============================================
app.get('/api/payment-success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Thanh toán thành công</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; 
                text-align: center; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
            h1 { color: #10b981; margin-bottom: 16px; font-size: 28px; }
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
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon">✅</div>
            <h1>Thanh toán thành công!</h1>
            <p>Cảm ơn bạn đã nâng cấp <span class="highlight">Premium</span>.</p>
            <p class="highlight">Bạn có thể đóng tab này.</p>
            <p class="note">Extension sẽ tự động kích hoạt Premium trong vài giây.</p>
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
    console.log('📥 Nhận request tạo thanh toán:', req.body);
    
    const { productName, price, returnUrl, cancelUrl } = req.body;
    
    if (!productName || !price) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu thông tin sản phẩm hoặc giá'
      });
    }
    
    const orderCode = Date.now();
    
    const paymentData = {
      orderCode: orderCode,
      amount: price,
      description: productName.substring(0, 25), // PayOS giới hạn 25 ký tự
      returnUrl: returnUrl || `https://packing-backend-pndo.onrender.com/api/payment-success`,
      cancelUrl: cancelUrl || `https://packing-backend-pndo.onrender.com/api/payment-success`,
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
    
    console.log('📤 Gửi request đến PayOS:', paymentData);
    
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
    
    // Store payment data
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
      message: 'Tạo link thanh toán thành công'
    });
    
  } catch (error) {
    console.error('❌ Lỗi tạo thanh toán:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Không thể tạo link thanh toán',
      error: error.response?.data?.message || error.message
    });
  }
});

// ============================================
// PAYOS WEBHOOK - QUAN TRỌNG!
// ============================================
app.post('/api/payos-webhook', async (req, res) => {
  try {
    console.log('🔔 ========== WEBHOOK RECEIVED ==========');
    console.log('🔔 Full body:', JSON.stringify(req.body, null, 2));
    
    // PayOS gửi data trong req.body với structure:
    // { code: "00", desc: "success", success: true, data: {...}, signature: "..." }
    
    const webhookBody = req.body;
    const code = webhookBody.code;
    const success = webhookBody.success;
    const webhookData = webhookBody.data;
    const signature = webhookBody.signature;
    
    console.log('🔔 Code:', code);
    console.log('🔔 Success:', success);
    console.log('🔔 Data:', webhookData);
    
    // Kiểm tra thanh toán thành công
    // PayOS trả về code "00" khi thành công
    if (code === '00' && success === true && webhookData) {
      
      const orderCode = webhookData.orderCode?.toString();
      const amount = webhookData.amount;
      
      console.log(`✅ Payment SUCCESS! Order: ${orderCode}, Amount: ${amount}`);
      
      // Tìm payment trong database
      let payment = payments.get(orderCode);
      
      // Nếu không tìm thấy, tạo mới (trường hợp webhook đến trước polling)
      if (!payment) {
        console.log('⚠️ Payment not found, creating new entry');
        payment = {
          orderId: orderCode,
          status: 'pending',
          amount: amount,
          createdAt: new Date().toISOString(),
          licenseKey: null
        };
      }
      
      // Chỉ xử lý nếu chưa completed
      if (payment.status !== 'completed') {
        // Tạo license key
        const licenseKey = generateLicenseKey();
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1); // 1 năm
        
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
        payment.payosData = webhookData;
        payments.set(orderCode, payment);
        
        console.log(`🔑 License created: ${licenseKey}`);
        console.log(`📅 Expiry: ${expiryDate.toISOString()}`);
      } else {
        console.log('ℹ️ Payment already completed, skipping');
      }
    } else {
      console.log('⚠️ Payment not successful or missing data');
      console.log('   Code:', code);
      console.log('   Success:', success);
    }
    
    // Luôn trả về success cho PayOS
    console.log('🔔 ========== WEBHOOK END ==========');
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    // Vẫn trả về 200 để PayOS không retry
    res.json({ success: true, error: error.message });
  }
});

// ============================================
// GET LICENSE BY ORDER ID (Extension polling)
// ============================================
app.get('/api/get-license/:orderId', (req, res) => {
  try {
    const { orderId } = req.params;
    console.log('🔍 Get license for order:', orderId);
    
    const payment = payments.get(orderId);
    
    console.log('📦 Payment found:', payment);
    
    if (!payment) {
      return res.json({
        success: false,
        status: 'not_found',
        message: 'Đang chờ xác nhận thanh toán...'
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
      
      console.log('✅ Returning license:', payment.licenseKey);
      
      return res.json({
        success: true,
        status: 'completed',
        licenseKey: payment.licenseKey,
        expiryDate: license?.expiryDate,
        message: 'Thanh toán thành công!'
      });
    }
    
    return res.json({
      success: false,
      status: 'unknown',
      message: 'Trạng thái không xác định'
    });
    
  } catch (error) {
    console.error('❌ Get license error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================
// ACTIVATE LICENSE (Manual key input)
// ============================================
app.post('/api/activate-license', (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    
    if (!checkActivationAttempts(ip)) {
      return res.status(429).json({
        success: false,
        message: 'Quá nhiều lần thử. Vui lòng thử lại sau 1 giờ.'
      });
    }
    
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
        message: 'Mã kích hoạt không hợp lệ'
      });
    }
    
    if (new Date(license.expiryDate) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Mã kích hoạt đã hết hạn'
      });
    }
    
    if (license.status === 'used' && deviceId) {
      const hashedDeviceId = hashDeviceId(deviceId);
      if (license.deviceId && license.deviceId !== hashedDeviceId) {
        return res.status(400).json({
          success: false,
          message: 'Mã đã được sử dụng trên thiết bị khác'
        });
      }
    }
    
    // Activate
    if (deviceId) {
      license.deviceId = hashDeviceId(deviceId);
    }
    license.status = 'used';
    license.activatedAt = new Date().toISOString();
    licenses.set(trimmedKey, license);
    
    res.json({
      success: true,
      message: 'Kích hoạt thành công!',
      expiryDate: license.expiryDate
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống'
    });
  }
});

// ============================================
// ADMIN - View all data (for debugging)
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
  console.log('\n🚀 ==========================================');
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📍 URL: https://packing-backend-pndo.onrender.com`);
  console.log('\n📝 Endpoints:');
  console.log('   POST /api/create-payment');
  console.log('   POST /api/payos-webhook');
  console.log('   GET  /api/get-license/:orderId');
  console.log('   GET  /api/payment-success');
  console.log('   GET  /api/admin/debug');
  console.log('==========================================\n');
});
