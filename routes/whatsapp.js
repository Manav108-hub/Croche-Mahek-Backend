// routes/whatsapp.js
// Optional: Add this to server.js for enhanced WhatsApp security
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { rateLimit } from '../middleware/auth.js';

const router = express.Router();

// Inquiry Log Schema
const inquirySchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  ipAddress: String,
  userAgent: String,
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  verified: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

inquirySchema.index({ product: 1, ipAddress: 1, timestamp: -1 });
const Inquiry = mongoose.model('Inquiry', inquirySchema);

// Stricter rate limiter for WhatsApp inquiries
const whatsappLimiter = rateLimit(5, 60 * 60 * 1000); // 5 per hour

// Generate secure WhatsApp link with token
router.post('/product/:id/whatsapp', whatsappLimiter, async (req, res) => {
  try {
    const { id } = req.params;
    const { captchaToken, honeypot } = req.body;

    // Honeypot check (bot detection)
    if (honeypot) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request'
      });
    }

    // Optional: Verify CAPTCHA token here
    // if (captchaToken) {
    //   const captchaValid = await verifyCaptcha(captchaToken);
    //   if (!captchaValid) {
    //     return res.status(400).json({
    //       success: false,
    //       message: 'CAPTCHA verification failed'
    //     });
    //   }
    // }

    // Get product
    const Product = (await import('../models/model.js')).Product;
    const product = await Product.findOne({ _id: id, isActive: true });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    // Check recent inquiries from this IP for this product
    const recentInquiries = await Inquiry.countDocuments({
      product: id,
      ipAddress: req.ip,
      timestamp: { $gte: new Date(Date.now() - 3600000) } // Last hour
    });

    if (recentInquiries >= 3) {
      return res.status(429).json({
        success: false,
        message: 'Too many inquiries for this product. Please try again later.'
      });
    }

    // Log inquiry
    await Inquiry.create({
      product: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      userId: req.user?.id,
      verified: !!captchaToken
    });

    // Generate time-limited token
    const token = jwt.sign(
      { 
        productId: id, 
        userId: req.user?.id,
        timestamp: Date.now() 
      },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    // Return redirect URL instead of direct WhatsApp link
    const redirectUrl = `${req.protocol}://${req.get('host')}/api/whatsapp/redirect/${token}`;

    res.json({
      success: true,
      redirectUrl,
      expiresIn: 300 // 5 minutes
    });
  } catch (error) {
    console.error('WhatsApp inquiry error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating inquiry link'
    });
  }
});

// Redirect endpoint (validates token and redirects to WhatsApp)
router.get('/redirect/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get product
    const Product = (await import('../models/model.js')).Product;
    const product = await Product.findById(decoded.productId)
      .populate('category', 'name');

    if (!product) {
      return res.status(404).send('Product not found');
    }

    // Generate WhatsApp link
    const cleanNumber = product.whatsappNumber.replace(/[\s+]/g, '');
    const message = product.whatsappMessage
      .replace('{productName}', product.name)
      .replace('{productPrice}', `₹${product.effectivePrice}`)
      .replace('{productSKU}', product.sku || '')
      .replace('{productCategory}', product.category?.name || '');
    
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${cleanNumber}?text=${encodedMessage}`;

    // Redirect to WhatsApp
    res.redirect(whatsappUrl);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(410).send('Inquiry link expired. Please request a new one.');
    }
    res.status(400).send('Invalid inquiry link');
  }
});

// Admin: Get inquiry analytics
router.get('/admin/inquiries', async (req, res) => {
  try {
    const { startDate, endDate, productId } = req.query;

    const filter = {};
    if (startDate) filter.timestamp = { $gte: new Date(startDate) };
    if (endDate) filter.timestamp = { ...filter.timestamp, $lte: new Date(endDate) };
    if (productId) filter.product = productId;

    const inquiries = await Inquiry.find(filter)
      .populate('product', 'name sku')
      .populate('userId', 'username email')
      .sort({ timestamp: -1 })
      .limit(100);

    const stats = await Inquiry.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$product',
          count: { $sum: 1 },
          uniqueIPs: { $addToSet: '$ipAddress' }
        }
      },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          productName: '$product.name',
          inquiryCount: '$count',
          uniqueUsers: { $size: '$uniqueIPs' }
        }
      },
      { $sort: { inquiryCount: -1 } }
    ]);

    res.json({
      success: true,
      data: inquiries,
      stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching inquiry analytics'
    });
  }
});

export default router;