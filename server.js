require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

const PAYOS_CONFIG = {
  clientId: process.env.PAYOS_CLIENT_ID,
  apiKey: process.env.PAYOS_API_KEY,
  checksumKey: process.env.PAYOS_CHECKSUM_KEY
};

const PORT = process.env.PORT || 3000;
const licenses = new Map();
const payments = new Map();

function generateLicenseKey() {
  const prefix = 'PACK';
  const random = crypto.randomBytes(12).toString('hex').toUpperCase();
  return `${prefix}-${random.slice(0, 4)}-${random.slice(4, 8)}-${random.slice(8, 12)}-${random.slice(12)}`;
}

function generateSignature(data) {
  const sortedKeys = Object.keys(data).sort();
  const signaturePayload = sortedKeys.map(key => `${key}=${data[key]}`).join('&');
  return crypto.createHmac('sha256', PAYOS_CONFIG.checksumKey).update(signaturePayload).digest('hex');
}

app.get('/', (req, res) => {
  res.json({
    status: 'running',
    message: 'Backend dang hoat dong',
    endpoints: {
      createPayment: 'POST /api/create-payment',
      webhook: 'POST /api/payos-webhook',
      activateLicense: 'POST /api/activate-license',
      checkLicense: 'POST /api/check-license'
    }
  });
});

app.post('/api/create-payment', async (req, res) => {
  try {
    console.log('Nhan request tao thanh toan:', req.body);
    const { productName, price, returnUrl, cancelUrl } = req.body;
    
    if (!productName || !price) {
      return res.status(400).json({ success: false, message: 'Thieu thong tin' });
    }
    
    const orderCode = Date.now();
    const paymentData = {
      orderCode: orderCode,
      amount: price,
      description: productName,
      returnUrl: returnUrl || `${req.protocol}://${req.get('host')}/success`,
      cancelUrl: cancelUrl || `${req.protocol}://${req.get('host')}/cancel`,
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
      productName: productName,
      createdAt: new Date().toISOString(),
      licenseKey: null
    });
    
    res.json({
      success: true,
      checkoutUrl: payosResponse.data.data.checkoutUrl,
      orderId: orderCode
    });
    
  } catch (error) {
    console.error('Loi tao thanh toan:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: 'Khong the tao link thanh toan',
      error: error.response?.data?.message || error.message
    });
  }
});

app.post('/api/payos-webhook', async (req, res) => {
  try {
    console.log('Nhan webhook tu PayOS:', req.body);
    const webhookData = req.body.data || req.body;
    const { orderCode, status, amount } = webhookData;
    
    if (status === 'PAID' || status === 'paid') {
      const existingPayment = payments.get(orderCode.toString());
      if (existingPayment && existingPayment.licenseKey) {
        return res.json({ success: true, licenseKey: existingPayment.licenseKey });
      }
      
      const licenseKey = generateLicenseKey();
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      
      licenses.set(licenseKey, {
        licenseKey: licenseKey,
        orderId: orderCode,
        status: 'active',
        createdAt: new Date().toISOString(),
        expiryDate: expiryDate.toISOString(),
        activatedAt: null,
        amount: amount
      });
      
      if (existingPayment) {
        existingPayment.status = 'completed';
        existingPayment.licenseKey = licenseKey;
        existingPayment.completedAt = new Date().toISOString();
        payments.set(orderCode.toString(), existingPayment);
      }
      
      console.log('Thanh toan thanh cong! License:', licenseKey);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Loi xu ly webhook:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/activate-license', (req, res) => {
  try {
    const { licenseKey } = req.body;
    if (!licenseKey) {
      return res.status(400).json({ success: false, message: 'Vui long nhap ma kich hoat' });
    }
    
    const trimmedKey = licenseKey.trim().toUpperCase();
    const license = licenses.get(trimmedKey);
    
    if (!license) {
      return res.status(404).json({ success: false, message: 'Ma kich hoat khong ton tai' });
    }
    
    if (new Date(license.expiryDate) < new Date()) {
      return res.status(400).json({ success: false, message: 'Ma kich hoat da het han' });
    }
    
    if (license.status === 'used') {
      return res.status(400).json({ success: false, message: 'Ma kich hoat da duoc su dung' });
    }
    
    license.status = 'used';
    license.activatedAt = new Date().toISOString();
    licenses.set(trimmedKey, license);
    
    res.json({ success: true, message: 'Kich hoat thanh cong', expiryDate: license.expiryDate });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Loi he thong' });
  }
});

app.post('/api/check-license', (req, res) => {
  try {
    const { licenseKey } = req.body;
    if (!licenseKey) {
      return res.json({ valid: false, message: 'Khong co license key' });
    }
    
    const license = licenses.get(licenseKey.trim().toUpperCase());
    if (!license) {
      return res.json({ valid: false, message: 'License khong ton tai' });
    }
    
    if (new Date(license.expiryDate) < new Date()) {
      return res.json({ valid: false, message: 'License da het han' });
    }
    
    res.json({
      valid: true,
      expiryDate: license.expiryDate,
      status: license.status
    });
  } catch (error) {
    res.status(500).json({ valid: false, message: 'Loi he thong' });
  }
});

app.get('/api/payment-status/:orderId', (req, res) => {
  const payment = payments.get(req.params.orderId);
  if (!payment) {
    return res.status(404).json({ success: false, message: 'Khong tim thay don hang' });
  }
  res.json({ success: true, payment: payment });
});

app.get('/api/admin/licenses', (req, res) => {
  res.json({ total: licenses.size, licenses: Array.from(licenses.values()) });
});

app.get('/api/admin/payments', (req, res) => {
  res.json({ total: payments.size, payments: Array.from(payments.values()) });
});

app.listen(PORT, () => {
  console.log('\n========================================');
  console.log(`Server dang chay tai: http://localhost:${PORT}`);
  console.log('PayOS Configuration:');
  console.log(`  Client ID: ${PAYOS_CONFIG.clientId?.substring(0, 8)}...`);
  console.log(`  API Key: ${PAYOS_CONFIG.apiKey?.substring(0, 8)}...`);
  console.log('\nAPI Endpoints:');
  console.log(`  POST /api/create-payment`);
  console.log(`  POST /api/payos-webhook`);
  console.log(`  POST /api/activate-license`);
  console.log(`  POST /api/check-license`);
  console.log('========================================\n');
});