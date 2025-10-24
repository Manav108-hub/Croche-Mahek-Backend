// routes/auth.js
import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/userModel.js';
import { generateAccessToken, generateRefreshToken, protect } from '../middleware/auth.js';

const router = express.Router();

// Register (Regular User Only - No Admin)
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, role } = req.body;

    // Prevent admin registration through regular signup
    if (role === 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin registration not allowed through this endpoint'
      });
    }

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username, email, and password'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    const existing = await User.findOne({
      $or: [{ email }, { username }]
    });
    
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Username or email already in use'
      });
    }

    // Force role to 'user' for regular registration
    // Force role to 'user' for regular registration
    const user = new User({ username, email, password, role: 'user' });
    await user.save();

    return res.status(201).json({
      success: true,
      message: 'User registered successfully'
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while registering'
    });
  }
});

// Register Admin (Requires Admin Secret Token)
router.post('/register-admin', async (req, res) => {
  try {
    const { username, email, password, adminToken } = req.body;

    // Verify admin token
    if (!adminToken || adminToken !== process.env.ADMIN_SECRET_TOKEN) {
      return res.status(403).json({
        success: false,
        message: 'Invalid admin token. Admin registration denied.'
      });
    }

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide username, email, and password'
      });
    }

    if (password.length < 12) {
      return res.status(400).json({
        success: false,
        message: 'Admin password must be at least 12 characters long'
      });
    }

    // Strong password validation for admin
    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{12,}$/;
    if (!strongPasswordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message: 'Admin password must contain uppercase, lowercase, number, and special character'
      });
    }

    const existing = await User.findOne({
      $or: [{ email }, { username }]
    });
    
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Username or email already in use'
      });
    }

    const admin = new User({ 
      username, 
      email, 
      password, 
      role: 'admin' 
    });
    await admin.save();

    return res.status(201).json({
      success: true,
      message: 'Admin registered successfully',
      admin: {
        id: admin._id,
        username: admin.username,
        email: admin.email
      }
    });
  } catch (error) {
    console.error('Admin register error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while registering admin'
    });
  }
});

// Login (For both users and admins)
router.post('/login', async (req, res) => {
  try {
    const { email, password, adminToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // If user is admin, require admin token for login
    if (user.role === 'admin') {
      if (!adminToken || adminToken !== process.env.ADMIN_SECRET_TOKEN) {
        // Increment failed attempts even for missing admin token
        await user.incrementLoginAttempts();
        return res.status(403).json({
          success: false,
          message: 'Admin token required for admin login'
        });
      }
    }

    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: 'Account locked due to too many failed login attempts. Try again later.'
      });
    }

    const isMatch = await user.matchPassword(password);
    
    if (!isMatch) {
      await user.incrementLoginAttempts();
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    await user.resetLoginAttempts();

    const accessToken = generateAccessToken(user._id, user.role);
    const refreshToken = generateRefreshToken(user._id);

    user.refreshTokens.push({ token: refreshToken });
    await user.save();

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while logging in'
    });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    const user = await User.findById(decoded.id);
    
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    const tokenExists = user.refreshTokens.some(t => t.token === refreshToken);
    
    if (!tokenExists) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    const newAccessToken = generateAccessToken(user._id, user.role);

    return res.json({
      success: true,
      accessToken: newAccessToken
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired refresh token'
    });
  }
});

// Logout
router.post('/logout', protect, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (refreshToken) {
      await User.findByIdAndUpdate(req.user.id, {
        $pull: { refreshTokens: { token: refreshToken } }
      });
    }

    return res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error logging out'
    });
  }
});

// Get current user
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -refreshTokens');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    return res.json({
      success: true,
      data: user
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error fetching user data'
    });
  }
});

export default router;