import express from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { protect, adminOnly } from '../middleware/auth.js';
import { deleteFromCloudinary, deleteMultipleFromCloudinary } from './upload.js';


const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
});

// Single image upload
router.post('/single', protect, adminOnly, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided',
      });
    }

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'crochet-catalog',
          transformation: [{ width: 1000, height: 1000, crop: 'limit', quality: 'auto' }],
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      );
      uploadStream.end(req.file.buffer);
    });

    res.json({
      success: true,
      data: {
        url: result.secure_url,
        public_id: result.public_id,
      },
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload image',
      error: error.message,
    });
  }
});

// Multiple images upload
router.post('/multiple', protect, adminOnly, upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No image files provided',
      });
    }

    // Upload all images to Cloudinary
    const uploadPromises = req.files.map((file) => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'crochet-catalog',
            transformation: [{ width: 1000, height: 1000, crop: 'limit', quality: 'auto' }],
          },
          (error, result) => {
            if (error) reject(error);
            else resolve({ url: result.secure_url, public_id: result.public_id });
          }
        );
        uploadStream.end(file.buffer);
      });
    });

    const uploadedImages = await Promise.all(uploadPromises);

    res.json({
      success: true,
      data: uploadedImages,
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload images',
      error: error.message,
    });
  }
});

// ================================
// 🗑️ Cloudinary Deletion Helpers
// ================================

export async function deleteFromCloudinary(public_id) {
  try {
    await cloudinary.uploader.destroy(public_id);
    console.log(`✅ Deleted image: ${public_id}`);
  } catch (error) {
    console.error(`❌ Error deleting image (${public_id}):`, error.message);
  }
}

export async function deleteMultipleFromCloudinary(publicIds) {
  try {
    const deletePromises = publicIds.map(id => cloudinary.uploader.destroy(id));
    await Promise.all(deletePromises);
    console.log(`✅ Deleted ${publicIds.length} images`);
  } catch (error) {
    console.error('❌ Error deleting multiple images:', error.message);
  }
}


export default router;