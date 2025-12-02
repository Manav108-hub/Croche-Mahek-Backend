// server.js
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import morgan from 'morgan';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Create logs directory
const logDirectory = path.join(__dirname, 'logs');
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory);
}

const accessLogStream = fs.createWriteStream(
  path.join(logDirectory, 'access.log'),
  { flags: 'a' }
);

const app = express();

// ──────────────────────────────────────────────────────────────────────────────
// SECURITY MIDDLEWARE
// ──────────────────────────────────────────────────────────────────────────────

// Helmet - sets various HTTP headers for security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Rate limiting for all routes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// Stricter rate limit for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  }
});

// MongoDB query sanitization (prevent NoSQL injection)
app.use(mongoSanitize());

// ──────────────────────────────────────────────────────────────────────────────
// LOGGING
// ──────────────────────────────────────────────────────────────────────────────

app.use(morgan('combined', { stream: accessLogStream }));
app.use(morgan('dev'));

// ──────────────────────────────────────────────────────────────────────────────
// CORS
// ──────────────────────────────────────────────────────────────────────────────

const allowedOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',') 
  : ['http://localhost:3000'];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

// ──────────────────────────────────────────────────────────────────────────────
// BODY PARSING
// ──────────────────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ──────────────────────────────────────────────────────────────────────────────
// ROUTES
// ──────────────────────────────────────────────────────────────────────────────

// Dynamic imports for routes
const authRoutes = await import('./routes/auth.js');
const appRoutes = await import('./routes/routes.js');
const uploadRoutes = await import('./routes/upload.js');

app.use('/api/auth', authRoutes.default);
app.use('/api', appRoutes.default);
app.use('/api/upload', uploadRoutes.default);

// ──────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ──────────────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    message: 'Crochet Product Catalog API',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      auth: {
        'POST /api/auth/register': 'Register new user',
        'POST /api/auth/login': 'Login (returns access & refresh tokens)',
        'POST /api/auth/refresh': 'Refresh access token',
        'POST /api/auth/logout': 'Logout user',
        'GET  /api/auth/me': 'Get current user info'
      },
      categories: {
        'GET    /api/categories': 'Get all categories (public)',
        'GET    /api/category/:id': 'Get single category (public)',
        'POST   /api/category': 'Create category (admin)',
        'PUT    /api/category/:id': 'Update category (admin)',
        'DELETE /api/category/:id': 'Delete category (admin)'
      },
      products: {
        'GET    /api/products': 'Get all products with filters (public)',
        'GET    /api/products/featured': 'Get featured products (public)',
        'GET    /api/products/category/:id': 'Get products by category (public)',
        'GET    /api/product/:id': 'Get single product (public)',
        'GET    /api/products/search': 'Search products (public)',
        'POST   /api/product': 'Create product (admin)',
        'PUT    /api/product/:id': 'Update product (admin)',
        'DELETE /api/product/:id': 'Delete product (admin)'
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// ERROR HANDLERS
// ──────────────────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  const errorEntry = `${new Date().toISOString()} - ERROR: ${err.message} - ${req.method} ${req.originalUrl}\n`;
  fs.appendFile(path.join(logDirectory, 'error.log'), errorEntry, (writeErr) => {
    if (writeErr) console.error('Failed to write to error.log:', writeErr);
  });

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

app.use((req, res) => {
  const notFoundEntry = `${new Date().toISOString()} - 404: ${req.method} ${req.originalUrl}\n`;
  fs.appendFile(path.join(logDirectory, 'error.log'), notFoundEntry, (writeErr) => {
    if (writeErr) console.error('Failed to write to error.log:', writeErr);
  });

  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// DATABASE CONNECTION
// ──────────────────────────────────────────────────────────────────────────────

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    console.log('   Database:', mongoose.connection.name);
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  });

mongoose.connection.on('disconnected', () => {
  console.log('❌ MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

// ──────────────────────────────────────────────────────────────────────────────
// START SERVER
// ──────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Access API at: http://localhost:${PORT}`);
  console.log(`🔒 Security: Helmet enabled, Rate limiting active`);
});

export default app;