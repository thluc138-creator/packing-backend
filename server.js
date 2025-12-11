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
const licenses = new Map();       // licenseKey -> license data
const payments = new Map();       // orderId -> payment data
const deviceLicenses = new Map(); // hashedDeviceId -> licenseKey

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
    message: '✅ Packing Backend đang hoạt động',
    version: '3.1.0',
    endpoints: [
      'POST /api/create-payment',
      'POST /api/payos-webhook', 
      'GET  /api/get-license/:orderId',
      'POST /api/bind-device',
      'POST /api/check-device-license',
      'POST /api/activate-license',
      'GET  /api/payment-success',
      'GET  /api/admin/debug'
    ]
  });
});

// ============================================
// PAYMENT SUCCESS PAGE (Return URL từ PayOS)
// ============================================
app.get('/api/payment-success', (req, res) => {
  const { code, status, orderCode, cancel } = req.query;
  
  console.log('🔔 ========== PAYMENT RETURN ==========');
  console.log('Code:', code);
  console.log('Status:', status);
  console.log('OrderCode:', orderCode);
  console.log('Cancel:', cancel);
  
  // Xử lý thanh toán thành công
  if (code === '00' && status === 'PAID' && orderCode) {
    console.log('✅ Payment SUCCESS!');
    
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
      expiryDate.setFullYear(expiryDate.getFullYear() + 1); // 1 năm
      
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
      console.log(`📅 Expiry: ${expiryDate.toISOString()}`);
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
            .order-code { 
                background: #f3f4f6; 
                padding: 10px 20px; 
                border-radius: 8px; 
                font-family: monospace;
                margin: 16px 0;
                font-size: 14px;
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
            }
            .close-btn:hover { opacity: 0.9; }
            .note { font-size: 14px; color: #888; margin-top: 20px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="icon">${isSuccess ? '✅' : (isCancelled ? '❌' : '⏳')}</div>
            <h1>${isSuccess ? 'Thanh toán thành công!' : (isCancelled ? 'Đã hủy thanh toán' : 'Đang xử lý...')}</h1>
            ${isSuccess ? `
                <p>Cảm ơn bạn đã nâng cấp <strong>Premium</strong>!</p>
                <div class="order-code">Mã đơn: ${orderCode}</div>
                <p><strong>Bạn có thể đóng tab này.</strong></p>
                <p class="note">Extension sẽ tự động kích hoạt Premium trong vài giây.</p>
            ` : (isCancelled ? `
                <p>Bạn đã hủy thanh toán.</p>
                <p>Vui lòng thử lại nếu muốn nâng cấp Premium.</p>
            ` : `
                <p>Đang xử lý thanh toán...</p>
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
    console.log('📥 ========== CREATE PAYMENT ==========');
    console.log('Request body:', req.body);
    
    const { productName, price } = req.body;
    
    if (!productName || !price) {
      return res.status(400).json({ 
        success: false, 
        message: 'Thiếu thông tin sản phẩm hoặc giá' 
      });
    }
    
    const orderCode = Date.now();
    const backendReturnUrl = `https://packing-backend-pndo.onrender.com/api/payment-success`;
    
    const paymentData = {
      orderCode: orderCode,
      amount: price,
      description: productName.substring(0, 25), // PayOS giới hạn 25 ký tự
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
    
    console.log('📤 Calling PayOS API...');
    
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
    
    // Lưu payment vào database
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
    console.error('❌ Payment error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || error.message
    });
  }
});

// ============================================
// PAYOS WEBHOOK (Nhận thông báo từ PayOS)
// ============================================
app.post('/api/payos-webhook', (req, res) => {
  try {
    console.log('🔔 ========== WEBHOOK RECEIVED ==========');
    console.log('Body:', JSON.stringify(req.body, null, 2));
    
    const { code, success, data } = req.body;
    
    // PayOS gửi code "00" khi thành công
    if (code === '00' && success === true && data) {
      const orderCode = data.orderCode?.toString();
      const amount = data.amount;
      
      console.log(`✅ Webhook: Payment SUCCESS! Order: ${orderCode}, Amount: ${amount}`);
      
      let payment = payments.get(orderCode);
      
      if (!payment) {
        payment = {
          orderId: orderCode,
          status: 'pending',
          amount: amount,
          createdAt: new Date().toISOString(),
          licenseKey: null
        };
      }
      
      // Tạo license nếu chưa có
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
    
    // Luôn trả về success cho PayOS
    res.json({ success: true });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    res.json({ success: true }); // Vẫn trả về 200 để PayOS không retry
  }
});

// ============================================
// GET LICENSE BY ORDER ID (Extension polling)
// ============================================
app.get('/api/get-license/:orderId', (req, res) => {
  const { orderId } = req.params;
  
  console.log('🔍 Get license for order:', orderId);
  
  const payment = payments.get(orderId);
  
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
  
  res.json({
    success: false,
    status: 'unknown',
    message: 'Trạng thái không xác định'
  });
});

// ============================================
// BIND DEVICE TO LICENSE (Sau khi thanh toán)
// ============================================
app.post('/api/bind-device', (req, res) => {
  try {
    console.log('🔗 ========== BIND DEVICE ==========');
    
    const { licenseKey, deviceId } = req.body;
    
    if (!licenseKey || !deviceId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Thiếu licenseKey hoặc deviceId' 
      });
    }
    
    const license = licenses.get(licenseKey);
    
    if (!license) {
      return res.status(404).json({ 
        success: false, 
        message: 'License không tồn tại' 
      });
    }
    
    // Hash device ID để bảo mật
    const hashedDeviceId = hashDeviceId(deviceId);
    
    // Bind device vào license
    license.deviceId = hashedDeviceId;
    licenses.set(licenseKey, license);
    
    // Lưu mapping deviceId -> licenseKey để khôi phục
    deviceLicenses.set(hashedDeviceId, licenseKey);
    
    console.log(`✅ Device bound: ${hashedDeviceId.substring(0, 20)}... -> ${licenseKey}`);
    
    res.json({ 
      success: true, 
      message: 'Đã liên kết thiết bị với license' 
    });
    
  } catch (error) {
    console.error('❌ Bind device error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============================================
// CHECK DEVICE LICENSE (Khôi phục khi cài lại)
// ============================================
app.post('/api/check-device-license', (req, res) => {
  try {
    console.log('🔍 ========== CHECK DEVICE LICENSE ==========');
    
    const { deviceId } = req.body;
    
    if (!deviceId) {
      return res.json({ 
        success: false, 
        valid: false, 
        message: 'Không có deviceId' 
      });
    }
    
    // Hash device ID
    const hashedDeviceId = hashDeviceId(deviceId);
    
    console.log('Checking device:', hashedDeviceId.substring(0, 20) + '...');
    
    // Tìm license theo deviceId
    const licenseKey = deviceLicenses.get(hashedDeviceId);
    
    if (!licenseKey) {
      console.log('❌ No license found for this device');
      return res.json({ 
        success: false, 
        valid: false, 
        message: 'Không tìm thấy license cho thiết bị này' 
      });
    }
    
    const license = licenses.get(licenseKey);
    
    if (!license) {
      console.log('❌ License not found:', licenseKey);
      return res.json({ 
        success: false, 
        valid: false, 
        message: 'License không tồn tại' 
      });
    }
    
    // Kiểm tra hết hạn
    const expiryDate = new Date(license.expiryDate);
    const now = new Date();
    
    if (expiryDate < now) {
      console.log('❌ License expired:', license.expiryDate);
      return res.json({ 
        success: false, 
        valid: false, 
        message: 'License đã hết hạn',
        expiryDate: license.expiryDate
      });
    }
    
    // License còn hiệu lực
    const daysRemaining = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    
    console.log(`✅ License valid! Key: ${licenseKey}, Days remaining: ${daysRemaining}`);
    
    res.json({
      success: true,
      valid: true,
      licenseKey: licenseKey,
      expiryDate: license.expiryDate,
      daysRemaining: daysRemaining,
      message: 'License còn hiệu lực'
    });
    
  } catch (error) {
    console.error('❌ Check device license error:', error);
    res.json({ 
      success: false, 
      valid: false, 
      message: error.message 
    });
  }
});

// ============================================
// ACTIVATE LICENSE (Nhập key thủ công)
// ============================================
app.post('/api/activate-license', (req, res) => {
  try {
    console.log('🔑 ========== ACTIVATE LICENSE ==========');
    
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
      console.log('❌ License not found:', trimmedKey);
      return res.status(404).json({ 
        success: false, 
        message: 'Mã kích hoạt không hợp lệ' 
      });
    }
    
    // Kiểm tra hết hạn
    if (new Date(license.expiryDate) < new Date()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Mã kích hoạt đã hết hạn' 
      });
    }
    
    // Kiểm tra đã dùng trên thiết bị khác chưa
    if (deviceId) {
      const hashedDeviceId = hashDeviceId(deviceId);
      
      if (license.deviceId && license.deviceId !== hashedDeviceId) {
        return res.status(400).json({ 
          success: false, 
          message: 'Mã đã được sử dụng trên thiết bị khác' 
        });
      }
      
      // Bind device
      license.deviceId = hashedDeviceId;
      deviceLicenses.set(hashedDeviceId, trimmedKey);
    }
    
    license.status = 'used';
    license.activatedAt = new Date().toISOString();
    licenses.set(trimmedKey, license);
    
    console.log('✅ License activated:', trimmedKey);
    
    res.json({ 
      success: true, 
      message: 'Kích hoạt thành công!',
      expiryDate: license.expiryDate
    });
    
  } catch (error) {
    console.error('❌ Activate license error:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// ============================================
// ADMIN DEBUG (Xem dữ liệu - CHỈ DÙNG KHI DEBUG)
// ============================================
app.get('/api/admin/debug', (req, res) => {
  res.json({
    payments: Array.from(payments.entries()).map(([k, v]) => ({
      orderId: k,
      status: v.status,
      licenseKey: v.licenseKey,
      createdAt: v.createdAt,
      completedAt: v.completedAt
    })),
    licenses: Array.from(licenses.entries()).map(([k, v]) => ({
      key: k,
      status: v.status,
      expiryDate: v.expiryDate,
      deviceBound: v.deviceId ? true : false,
      createdAt: v.createdAt
    })),
    deviceBindings: Array.from(deviceLicenses.entries()).map(([k, v]) => ({
      deviceIdHash: k.substring(0, 20) + '...',
      licenseKey: v
    })),
    stats: {
      totalPayments: payments.size,
      totalLicenses: licenses.size,
      totalDeviceBindings: deviceLicenses.size
    },
    timestamp: new Date().toISOString()
  });
});

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log('\n');
  console.log('🚀 ==========================================');
  console.log(`   PACKING BACKEND v3.1.0`);
  console.log(`   Server running on port ${PORT}`);
  console.log('==========================================');
  console.log('\n📝 Available Endpoints:\n');
  console.log('   POST /api/create-payment       - Tạo link thanh toán');
  console.log('   POST /api/payos-webhook        - Nhận webhook từ PayOS');
  console.log('   GET  /api/get-license/:orderId - Lấy license theo order');
  console.log('   POST /api/bind-device          - Liên kết thiết bị');
  console.log('   POST /api/check-device-license - Kiểm tra license thiết bị');
  console.log('   POST /api/activate-license     - Kích hoạt thủ công');
  console.log('   GET  /api/payment-success      - Trang thành công');
  console.log('   GET  /api/admin/debug          - Debug (admin)');
  console.log('\n==========================================\n');
});
