import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { toEmail, projTitle, reason, applyUser, subject } = req.body;

  if (!toEmail) {
    return res.status(400).json({ error: 'Missing toEmail' });
  }

  // 建立 Gmail 發信連線
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });

  try {
    await transporter.sendMail({
      from: `"專案管理系統" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: subject || `簽核通知：${projTitle}`,
      html: `
        <div style="font-family: Arial, 'Microsoft JhengHei', sans-serif; padding: 24px; color: #1e293b; background-color: #f8fafc;">
          <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #e2e8f0;">
            <h2 style="color: #2563eb; margin-top: 0;">📋 ${subject || '專案通知'}</h2>
            <p style="font-size: 15px; margin: 8px 0;"><strong>專案名稱：</strong>${projTitle}</p>
            <p style="font-size: 15px; margin: 8px 0;"><strong>申請 / 發送同仁：</strong>${applyUser}</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;" />
            <p style="font-size: 14px; font-weight: bold; margin-bottom: 8px;">簽核說明 / 申請原因：</p>
            <div style="background-color: #f1f5f9; padding: 12px 16px; border-left: 4px solid #3b82f6; border-radius: 4px; font-size: 14px; line-height: 1.6;">
              ${reason || '無特別說明'}
            </div>
            <p style="margin-top: 24px; font-size: 12px; color: #94a3b8;">
              ※ 此信件由系統自動發送，請登入專案管理系統進行處理。
            </p>
          </div>
        </div>
      `
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("發信失敗:", err);
    return res.status(500).json({ error: err.message });
  }
}
