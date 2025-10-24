// models/model.js
import mongoose from 'mongoose';

// =====================
// CATEGORY SCHEMA
// =====================
const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    unique: true,
    trim: true,
    maxlength: [50, 'Category name cannot exceed 50 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [200, 'Description cannot exceed 200 characters']
  },
  image: {
    url: {
      type: String,
      required: [true, 'Category image URL is required']
    },
    public_id: {
      type: String,
      required: [true, 'Category image public_id is required']
    }
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

categorySchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  next();
});

categorySchema.index({ isActive: 1, sortOrder: 1 });

const Category = mongoose.model('Category', categorySchema);

// =====================
// PRODUCT SCHEMA (Generic)
// =====================
const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [100, 'Product name cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category is required']
  },
  images: [{
    url: {
      type: String,
      required: [true, 'Image URL is required']
    },
    public_id: {
      type: String,
      required: [true, 'Image public_id is required']
    },
    alt: {
      type: String,
      default: ''
    }
  }],
  price: {
    original: {
      type: Number,
      required: [true, 'Original price is required'],
      min: [0, 'Price cannot be negative']
    },
    discounted: {
      type: Number,
      min: [0, 'Discounted price cannot be negative'],
      validate: {
        validator: function(value) {
          return !value || value <= this.price.original;
        },
        message: 'Discounted price cannot exceed original price'
      }
    }
  },
  // Generic variants (for sizes, colors, types, etc.)
  variants: [{
    type: {
      type: String,
      required: [true, 'Variant type is required'],
      enum: ['size', 'color', 'material', 'style', 'custom']
    },
    name: {
      type: String,
      required: [true, 'Variant name is required']
    },
    value: {
      type: String,
      required: [true, 'Variant value is required']
    },
    available: {
      type: Boolean,
      default: true
    },
    stock: {
      type: Number,
      default: 0,
      min: [0, 'Stock cannot be negative']
    }
  }],
  specifications: {
    type: Map,
    of: String,
    default: {}
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  sku: {
    type: String,
    unique: true,
    sparse: true,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  whatsappNumber: {
    type: String,
    required: [true, 'WhatsApp number is required for orders'],
    validate: {
      validator: function(v) {
        return /^\+?[1-9]\d{1,14}$/.test(v);
      },
      message: 'Please enter a valid WhatsApp number (with country code)'
    }
  },
  whatsappMessage: {
    type: String,
    default: 'Hi! I am interested in this product: {productName}. Please provide more details about pricing, availability, and delivery.',
    maxlength: [500, 'WhatsApp message template cannot exceed 500 characters']
  },
  views: {
    type: Number,
    default: 0
  },
  rating: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

productSchema.index({ category: 1, isActive: 1 });
productSchema.index({ isFeatured: 1, isActive: 1 });
productSchema.index({ 'price.original': 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ tags: 1 });

productSchema.pre('save', async function(next) {
  if (!this.sku && this.isNew) {
    const count = await this.constructor.countDocuments();
    this.sku = `PROD${String(count + 1).padStart(4, '0')}`; 
  }
  next();
});

productSchema.virtual('discountPercentage').get(function() {
  if (this.price.discounted && this.price.original > 0) {
    return Math.round(
      ((this.price.original - this.price.discounted) / this.price.original) * 100
    );
  }
  return 0;
});

productSchema.virtual('effectivePrice').get(function() {
  return this.price.discounted || this.price.original;
});

productSchema.virtual('whatsappLink').get(function() {
  if (!this.whatsappNumber) return null;
  const cleanNumber = this.whatsappNumber.replace(/[\s+]/g, '');
  const message = this.whatsappMessage
    .replace('{productName}', this.name)
    .replace('{productPrice}', `₹${this.effectivePrice}`)
    .replace('{productSKU}', this.sku || '')
    .replace('{productCategory}', this.category?.name || '');
  const encodedMessage = encodeURIComponent(message);
  return `https://wa.me/${cleanNumber}?text=${encodedMessage}`;
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

const Product = mongoose.model('Product', productSchema);

export { Category, Product };