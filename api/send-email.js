const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { toEmail, projTitle, reason, applyUser, subject } = req.body;
  if (!toEmail) return res.status(400).json({ error: '缺少收件人信箱' });

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    return res.status(500).json({ error: `Vercel 環境變數缺失: user=${!!user}, pass=${!!pass}` });
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: user.trim(),
      pass: pass.replace(/\s+/g, '') // 自動消除 16 碼中的空格
    }
  });

  try {
    await transporter.sendMail({
      from: `"專案管理系統" <${user.trim()}>`,
      to: toEmail,
      subject: subject || `簽核通知：${projTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2 style="color: #2563eb;">📋 ${subject || '專案通知'}</h2>
          <p><strong>專案名稱：</strong>${projTitle}</p>
          <p><strong>申請同仁：</strong>${applyUser}</p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 15px 0;" />
          <p><strong>說明事項：</strong></p>
          <div style="background: #f1f5f9; padding: 12px; border-left: 4px solid #3b82f6;">${reason}</div>
        </div>
      `
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
