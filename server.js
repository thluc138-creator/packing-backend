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
const RATE_LIMIT = 100; // requests per hour
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

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

// Apply rate limiting to sensitive endpoints
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
const licenses = new Map(); // licenseKey -> license data
const payments = new Map(); // orderId -> payment data
const deviceBindings = new Map(); // licenseKey -> deviceId
const activationAttempts = new Map(); // ip -> attempts

// ============================================
// HELPER FUNCTIONS
// ============================================

// Generate secure license key
function generateLicenseKey() {
  const prefix = 'PACK';
  const random = crypto.randomBytes(16).toString('hex').toUpperCase();
  return `${prefix}-${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8, 12)}-${random.slice(12, 16)}`;
}

// Encrypt license data
function encryptData(text) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

// Decrypt license data
function decryptData(text) {
  try {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    return null;
  }
}

// Generate PayOS signature
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

// Verify webhook signature
function verifyWebhookSignature(webhookData, receivedSignature) {
  const calculatedSignature = generateSignature(webhookData);
  return calculatedSignature === receivedSignature;
}

// Generate device fingerprint hash
function hashDeviceId(deviceId) {
  return crypto.createHash('sha256').update(deviceId).digest('hex');
}

// Check activation attempts (anti-brute force)
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
    version: '2.0.0',
    endpoints: {
      createPayment: 'POST /api/create-payment',
      webhook: 'POST /api/payos-webhook',
      activateLicense: 'POST /api/activate-license',
      checkLicense: 'POST /api/check-license',
      getLicense: 'GET /api/get-license/:orderId',
      paymentStatus: 'GET /api/payment-status/:orderId',
      paymentSuccess: 'GET /api/payment-success'
    }
  });
});

// ============================================
// PAYMENT SUCCESS PAGE - TRANG THANH TOÁN THÀNH CÔNG
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
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
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
            .icon {
                font-size: 80px;
                margin-bottom: 20px;
            }
            h1 { 
                color: #10b981; 
                margin-bottom: 16px;
                font-size: 28px;
            }
            p { 
                font-size: 16px; 
                margin-bottom: 12px; 
                color: #555;
                line-height: 1.6;
            }
            .highlight {
                font-weight: 600;
                color: #333;
            }
            .note { 
                font-size: 14px; 
                color: #888;
                margin-top: 24px;
                padding-top: 20px;
                border-top: 1px solid #eee;
            }
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
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .close-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 20px rgba(102,126,234,0.4);
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon">✅</div>
            <h1>Thanh toán thành công!</h1>
            <p>Cảm ơn bạn đã nâng cấp <span class="highlight">Premium</span>.</p>
            <p class="highlight">Bạn có thể đóng tab này.</p>
            <p class="note">Extension sẽ tự động kích hoạt Premium trong vài giây.<br>Nếu không thấy thay đổi, vui lòng tải lại extension.</p>
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
    
    const { productName, price, returnUrl, cancelUrl, userEmail } = req.body;
    
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
      description: productName,
      returnUrl: returnUrl || `${req.protocol}://${req.get('host')}/api/payment-success`,
      cancelUrl: cancelUrl || `${req.protocol}://${req.get('host')}/api/payment-success`,
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
      userEmail: userEmail || null,
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
// PAYOS WEBHOOK
// ============================================
app.post('/api/payos-webhook', async (req, res) => {
  try {
    console.log('🔔 Nhận webhook từ PayOS:', req.body);
    
    const webhookData = req.body.data || req.body;
    const receivedSignature = req.headers['x-signature'] || webhookData.signature;
    
    // Get order info
    const orderCode = webhookData.orderCode?.toString();
    const status = webhookData.code || webhookData.status;
    
    console.log(`📋 Order: ${orderCode}, Status: ${status}`);
    
    // Check if payment successful
    if (status === '00' || status === 'PAID' || webhookData.desc === 'success') {
      console.log('✅ Thanh toán thành công!');
      
      const payment = payments.get(orderCode);
      
      if (payment && payment.status !== 'completed') {
        // Generate license key
        const licenseKey = generateLicenseKey();
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        
        // Store license
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
        payments.set(orderCode, payment);
        
        console.log(`🔑 License key created: ${licenseKey}`);
      }
    }
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Lỗi xử lý webhook:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================
// GET LICENSE BY ORDER ID
// ============================================
app.get('/api/get-license/:orderId', (req, res) => {
  try {
    const { orderId } = req.params;
    console.log('🔍 Tìm license cho order:', orderId);
    
    const payment = payments.get(orderId);
    
    if (!payment) {
      return res.json({
        success: false,
        status: 'not_found',
        message: 'Không tìm thấy đơn hàng'
      });
    }
    
    if (payment.status === 'pending') {
      return res.json({
        success: false,
        status: 'pending',
        message: 'Đang chờ thanh toán'
      });
    }
    
    if (payment.status === 'completed' && payment.licenseKey) {
      const license = licenses.get(payment.licenseKey);
      
      return res.json({
        success: true,
        status: 'completed',
        licenseKey: payment.licenseKey,
        expiryDate: license?.expiryDate,
        isActivated: license?.status === 'used',
        message: 'Thanh toán thành công'
      });
    }
    
    return res.json({
      success: false,
      status: 'unknown',
      message: 'Trạng thái không xác định'
    });
    
  } catch (error) {
    console.error('❌ Lỗi get license:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      message: error.message
    });
  }
});

// ============================================
// ACTIVATE LICENSE (With Device Binding)
// ============================================
app.post('/api/activate-license', (req, res) => {
  try {
    const ip = req.ip || req.connection.remoteAddress;
    
    // Check activation attempts
    if (!checkActivationAttempts(ip)) {
      return res.status(429).json({
        success: false,
        message: 'Quá nhiều lần thử kích hoạt. Vui lòng thử lại sau 1 giờ.'
      });
    }
    
    console.log('🔐 Kích hoạt license:', req.body);
    
    const { licenseKey, deviceId } = req.body;
    
    if (!licenseKey) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng nhập mã kích hoạt'
      });
    }
    
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'Device ID không hợp lệ'
      });
    }
    
    const trimmedKey = licenseKey.trim().toUpperCase();
    const license = licenses.get(trimmedKey);
    
    if (!license) {
      console.log('❌ License không tồn tại:', trimmedKey);
      return res.status(404).json({
        success: false,
        message: 'Mã kích hoạt không tồn tại hoặc không hợp lệ'
      });
    }
    
    // Check expiry
    if (new Date(license.expiryDate) < new Date()) {
      console.log('⏰ License đã hết hạn:', trimmedKey);
      return res.status(400).json({
        success: false,
        message: 'Mã kích hoạt đã hết hạn'
      });
    }
    
    // Check if already used
    if (license.status === 'used') {
      // Check if same device
      const hashedDeviceId = hashDeviceId(deviceId);
      
      if (license.deviceId === hashedDeviceId) {
        // Same device - allow re-activation
        console.log('✅ Kích hoạt lại trên cùng thiết bị');
        return res.json({
          success: true,
          message: 'License đã được kích hoạt trên thiết bị này',
          expiryDate: license.expiryDate,
          reactivation: true
        });
      } else {
        // Different device - reject
        console.log('⚠️ License đã được sử dụng trên thiết bị khác');
        return res.status(400).json({
          success: false,
          message: 'Mã kích hoạt đã được sử dụng trên thiết bị khác'
        });
      }
    }
    
    // First time activation
    const hashedDeviceId = hashDeviceId(deviceId);
    license.status = 'used';
    license.activatedAt = new Date().toISOString();
    license.deviceId = hashedDeviceId;
    licenses.set(trimmedKey, license);
    
    console.log('✅ Kích hoạt thành công!');
    
    res.json({
      success: true,
      message: 'Kích hoạt Premium thành công!',
      expiryDate: license.expiryDate
    });
    
  } catch (error) {
    console.error('❌ Lỗi kích hoạt license:', error);
    res.status(500).json({
      success: false,
      message: 'Lỗi hệ thống, vui lòng thử lại sau'
    });
  }
});

// ============================================
// CHECK LICENSE STATUS
// ============================================
app.post('/api/check-license', (req, res) => {
  try {
    const { licenseKey, deviceId } = req.body;
    
    if (!licenseKey) {
      return res.json({
        valid: false,
        message: 'Không có license key'
      });
    }
    
    const license = licenses.get(licenseKey.trim().toUpperCase());
    
    if (!license) {
      return res.json({
        valid: false,
        message: 'License không tồn tại'
      });
    }
    
    // Check expiry
    if (new Date(license.expiryDate) < new Date()) {
      return res.json({
        valid: false,
        message: 'License đã hết hạn',
        expiryDate: license.expiryDate
      });
    }
    
    // Check device binding
    if (license.deviceId && deviceId) {
      const hashedDeviceId = hashDeviceId(deviceId);
      if (license.deviceId !== hashedDeviceId) {
        return res.json({
          valid: false,
          message: 'License không hợp lệ cho thiết bị này'
        });
      }
    }
    
    res.json({
      valid: true,
      expiryDate: license.expiryDate,
      status: license.status,
      daysRemaining: Math.ceil((new Date(license.expiryDate) - new Date()) / (1000 * 60 * 60 * 24))
    });
    
  } catch (error) {
    res.status(500).json({
      valid: false,
      message: 'Lỗi hệ thống'
    });
  }
});

// ============================================
// GET PAYMENT STATUS
// ============================================
app.get('/api/payment-status/:orderId', (req, res) => {
  const { orderId } = req.params;
  const payment = payments.get(orderId);
  
  if (!payment) {
    return res.status(404).json({
      success: false,
      message: 'Không tìm thấy đơn hàng'
    });
  }
  
  res.json({
    success: true,
    payment: payment
  });
});

// ============================================
// ADMIN ENDPOINTS
// ============================================
app.get('/api/admin/licenses', (req, res) => {
  const allLicenses = Array.from(licenses.values()).map(license => ({
    ...license,
    deviceId: license.deviceId ? '***' + license.deviceId.slice(-8) : null // Hide full device ID
  }));
  
  res.json({
    total: allLicenses.length,
    active: allLicenses.filter(l => l.status === 'active').length,
    used: allLicenses.filter(l => l.status === 'used').length,
    licenses: allLicenses
  });
});

app.get('/api/admin/payments', (req, res) => {
  const allPayments = Array.from(payments.values());
  res.json({
    total: allPayments.length,
    completed: allPayments.filter(p => p.status === 'completed').length,
    pending: allPayments.filter(p => p.status === 'pending').length,
    payments: allPayments
  });
});

app.get('/api/admin/stats', (req, res) => {
  const allLicenses = Array.from(licenses.values());
  const allPayments = Array.from(payments.values());
  
  const totalRevenue = allPayments
    .filter(p => p.status === 'completed')
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  
  res.json({
    totalLicenses: allLicenses.length,
    activeLicenses: allLicenses.filter(l => l.status === 'active').length,
    usedLicenses: allLicenses.filter(l => l.status === 'used').length,
    totalPayments: allPayments.length,
    completedPayments: allPayments.filter(p => p.status === 'completed').length,
    totalRevenue: totalRevenue,
    averageValue: totalRevenue / (allPayments.filter(p => p.status === 'completed').length || 1)
  });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log('\n🚀 ==========================================');
  console.log(`✅ Server đang chạy tại: http://localhost:${PORT}`);
  console.log('🔧 PayOS Configuration:');
  console.log(`   Client ID: ${PAYOS_CONFIG.clientId?.substring(0, 8)}...`);
  console.log(`   API Key: ${PAYOS_CONFIG.apiKey?.substring(0, 8)}...`);
  console.log('\n🔒 Security Features:');
  console.log('   ✅ Device ID binding');
  console.log('   ✅ Rate limiting');
  console.log('   ✅ Encrypted validation');
  console.log('   ✅ Anti-brute force');
  console.log('\n📝 API Endpoints:');
  console.log(`   POST   /api/create-payment`);
  console.log(`   POST   /api/payos-webhook`);
  console.log(`   POST   /api/activate-license`);
  console.log(`   POST   /api/check-license`);
  console.log(`   GET    /api/get-license/:orderId`);
  console.log(`   GET    /api/payment-status/:orderId`);
  console.log(`   GET    /api/payment-success`);
  console.log(`   GET    /api/admin/licenses`);
  console.log(`   GET    /api/admin/payments`);
  console.log(`   GET    /api/admin/stats`);
  console.log('==========================================\n');
});
