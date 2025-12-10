const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
// Thêm các require khác của bạn ở đây (momo, zalopay, database...)

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// TRỌNG TÂM: PHẢI ĐẶT ROUTE NÀY LÊN TRÊN CÙNG, TRƯỚC MỌI THỨ KHÁC!!!
app.get('/api/payment-success', (req, res) => {
    const orderId = req.query.code || req.query.orderId || req.query.id || 'N/A';

    res.status(200).send(`
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Thanh toán thành công - Hệ Thống Đóng Hàng</title>
    <style>
        body{font-family:'Segoe UI',sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);margin:0;height:100vh;display:flex;align-items:center;justify-content:center;}
        .card{background:white;padding:40px 30px;border-radius:20px;box-shadow:0 20px 40px rgba(0,0,0,0.2);text-align:center;max-width:480px;width:90%;}
        h1{color:#10b981;font-size:28px;margin:20px 0 10px;}
        .success{font-size:90px;animation:pulse 2s infinite;}
        .info{font-size:18px;color:#333;line-height:1.8;margin:20px 0;}
        .btn{padding:14px 36px;background:#667eea;color:white;border:none;border-radius:12px;font-size:18px;cursor:pointer;margin-top:20px;}
        .btn:hover{transform:translateY(-3px);box-shadow:0 10px 20px rgba(102,126,234,0.4);}
        @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
    </style>
</head>
<body>
    <div class="card">
        <div class="success">Checkmark</div>
        <h1>Thanh toán thành công!</h1>
        <div class="info">
            Mã đơn: <strong>${orderId}</strong><br><br>
            Premium đã được kích hoạt tự động<br>
            Bạn có thể đóng tab này
        </div>
        <button class="btn" onclick="window.close()">Đóng tab này</button>
    </div>

    <script>
        if(window.opener){
            window.opener.postMessage({type:'PAYMENT_SUCCESS',orderId:'${orderId}'},'*');
        }
        setTimeout(()=>window.close(),15000);
    </script>
</body>
</html>
    `);
});

// Các route API của bạn ở đây (create-payment, get-license, v.v.)
// Ví dụ:
app.post('/api/create-payment', async (req, res) => { /* code của bạn */ });
app.get('/api/get-license/:orderId', async (req, res) => { /* code trả key */ });

// Route 404 để dưới cùng
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Not Found' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
