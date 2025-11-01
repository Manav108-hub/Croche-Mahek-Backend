// routes/routes.js
import express from 'express';
import { Category, Product } from '../models/model.js';
import { protect, adminOnly, rateLimit } from '../middleware/auth.js';
import { deleteFromCloudinary, deleteMultipleFromCloudinary } from '../utils/cloudinaryHelpers.js';


const router = express.Router();

// =====================
// CATEGORY ROUTES
// =====================

// Public: Get all categories
router.get('/categories', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ sortOrder: 1, createdAt: -1 })
      .select('-__v');
    res.json({ success: true, count: categories.length, data: categories });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching categories',
      error: error.message
    });
  }
});

// Public: Get single category
router.get('/category/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);
    const query = isObjectId ? { _id: identifier } : { slug: identifier };

    const category = await Category.findOne({ ...query, isActive: true });
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.json({ success: true, data: category });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching category',
      error: error.message
    });
  }
});

// Admin: Create category
router.post('/category', protect, adminOnly, async (req, res) => {
  try {
    const { name, description, sortOrder, imageUrl, public_id } = req.body;

    if (!imageUrl || !public_id) {
      return res.status(400).json({
        success: false,
        message: 'imageUrl and public_id are required'
      });
    }

    const category = new Category({
      name,
      description,
      image: { url: imageUrl, public_id },
      sortOrder: sortOrder || 0
    });

    const savedCategory = await category.save();
    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: savedCategory
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Category name already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating category',
      error: error.message
    });
  }
});

// Admin: Update category
router.put('/category/:id', protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, sortOrder, isActive, imageUrl, public_id } = req.body;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    if (name) category.name = name;
    if (description !== undefined) category.description = description;
    if (sortOrder !== undefined) category.sortOrder = sortOrder;
    if (isActive !== undefined) category.isActive = isActive;

    if (imageUrl && public_id) {
      await deleteFromCloudinary(category.image.public_id);
      category.image = { url: imageUrl, public_id };
    }

    const updatedCategory = await category.save();
    res.json({
      success: true,
      message: 'Category updated successfully',
      data: updatedCategory
    });
  } catch (error) {
    if (req.body.public_id) {
      await deleteFromCloudinary(req.body.public_id);
    }

    res.status(500).json({
      success: false,
      message: 'Error updating category',
      error: error.message
    });
  }
});

// Admin: Delete category
router.delete('/category/:id', protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const productCount = await Product.countDocuments({ category: id });
    if (productCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category. ${productCount} products belong to this category.`
      });
    }

    await deleteFromCloudinary(category.image.public_id);
    await Category.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting category',
      error: error.message
    });
  }
});

// =====================
// PRODUCT ROUTES
// =====================

// Public: Get all products with filters
router.get('/products', async (req, res) => {
  try {
    const {
      category,
      featured,
      minPrice,
      maxPrice,
      tag,
      sort = '-createdAt',
      page = 1,
      limit = 12
    } = req.query;

    const filter = { isActive: true };

    if (category) filter.category = category;
    if (featured === 'true') filter.isFeatured = true;
    if (tag) filter.tags = tag;

    if (minPrice || maxPrice) {
      filter['price.original'] = {};
      if (minPrice) filter['price.original'].$gte = Number(minPrice);
      if (maxPrice) filter['price.original'].$lte = Number(maxPrice);
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(50, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const sortOptions = {
      '-createdAt': { createdAt: -1 },
      'createdAt': { createdAt: 1 },
      'price': { 'price.original': 1 },
      '-price': { 'price.original': -1 },
      'name': { name: 1 },
      '-name': { name: -1 },
      'featured': { isFeatured: -1, createdAt: -1 }
    };

    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .sort(sortOptions[sort] || { createdAt: -1 })
      .limit(limitNum)
      .skip(skip)
      .select('-__v');

    const total = await Product.countDocuments(filter);

    res.json({
      success: true,
      count: products.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching products',
      error: error.message
    });
  }
});

// Public: Get featured products
router.get('/products/featured', async (req, res) => {
  try {
    const { limit = 8 } = req.query;
    const products = await Product.find({ isActive: true, isFeatured: true })
      .populate('category', 'name slug')
      .sort({ sortOrder: 1, createdAt: -1 })
      .limit(parseInt(limit))
      .select('-__v');

    res.json({
      success: true,
      count: products.length,
      data: products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching featured products',
      error: error.message
    });
  }
});

// Public: Get products by category
router.get('/products/category/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { sort = '-createdAt', page = 1, limit = 12 } = req.query;

    const category = await Category.findOne({
      $or: [{ _id: categoryId }, { slug: categoryId }],
      isActive: true
    });
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(50, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const sortOptions = {
      '-createdAt': { createdAt: -1 },
      'createdAt': { createdAt: 1 },
      'price': { 'price.original': 1 },
      '-price': { 'price.original': -1 },
      'name': { name: 1 },
      'featured': { isFeatured: -1, createdAt: -1 }
    };

    const products = await Product.find({ category: category._id, isActive: true })
      .populate('category', 'name slug')
      .sort(sortOptions[sort] || { createdAt: -1 })
      .limit(limitNum)
      .skip(skip)
      .select('-__v');

    const total = await Product.countDocuments({ category: category._id, isActive: true });

    res.json({
      success: true,
      category: {
        id: category._id,
        name: category.name,
        slug: category.slug
      },
      count: products.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching products by category',
      error: error.message
    });
  }
});

// Public: Get single product (with rate limiting)
router.get('/product/:id', rateLimit(50, 60000), async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findOne({ _id: id, isActive: true })
      .populate('category', 'name slug description')
      .select('-__v');

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    await Product.findByIdAndUpdate(id, { $inc: { views: 1 } });

    res.json({ success: true, data: product });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching product',
      error: error.message
    });
  }
});

// Admin: Create product
router.post('/product', protect, adminOnly, async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      price,
      variants,
      specifications,
      tags,
      whatsappNumber,
      isFeatured,
      sortOrder,
      images
    } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one product image is required'
      });
    }

    let parsedVariants, parsedTags, parsedPrice, parsedSpecs;
    try {
      parsedPrice = typeof price === 'string' ? JSON.parse(price) : price;
      parsedVariants = typeof variants === 'string' ? JSON.parse(variants) : variants;
      parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
      parsedSpecs = typeof specifications === 'string' ? JSON.parse(specifications) : specifications;
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid JSON format in request data'
      });
    }

    const product = new Product({
      name,
      description,
      category,
      price: parsedPrice,
      images,
      variants: parsedVariants || [],
      specifications: parsedSpecs || {},
      tags: parsedTags || [],
      whatsappNumber,
      isFeatured: isFeatured === true || isFeatured === 'true',
      sortOrder: sortOrder || 0
    });

    const savedProduct = await product.save();
    await savedProduct.populate('category', 'name slug');

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      data: savedProduct
    });
  } catch (error) {
    if (req.body.images && Array.isArray(req.body.images)) {
      const publicIds = req.body.images.map((img) => img.public_id);
      await deleteMultipleFromCloudinary(publicIds);
    }
    res.status(500).json({
      success: false,
      message: 'Error creating product',
      error: error.message
    });
  }
});

// Admin: Update product
router.put('/product/:id', protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      category,
      price,
      variants,
      specifications,
      tags,
      whatsappNumber,
      isFeatured,
      isActive,
      sortOrder,
      removeImages,
      newImages
    } = req.body;

    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    let parsedVariants, parsedTags, parsedPrice, parsedSpecs, parsedRemoveImages;
    try {
      if (price) parsedPrice = typeof price === 'string' ? JSON.parse(price) : price;
      if (variants) parsedVariants = typeof variants === 'string' ? JSON.parse(variants) : variants;
      if (tags) parsedTags = typeof tags === 'string' ? JSON.parse(tags) : tags;
      if (specifications) parsedSpecs = typeof specifications === 'string' ? JSON.parse(specifications) : specifications;
      if (removeImages) parsedRemoveImages = Array.isArray(removeImages) ? removeImages : JSON.parse(removeImages);
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid JSON format in request data'
      });
    }

    if (name) product.name = name;
    if (description !== undefined) product.description = description;
    if (category) product.category = category;
    if (parsedPrice) product.price = parsedPrice;
    if (parsedVariants) product.variants = parsedVariants;
    if (parsedSpecs) product.specifications = parsedSpecs;
    if (parsedTags) product.tags = parsedTags;
    if (whatsappNumber) product.whatsappNumber = whatsappNumber;
    if (isFeatured !== undefined) product.isFeatured = isFeatured === true || isFeatured === 'true';
    if (isActive !== undefined) product.isActive = isActive === true || isActive === 'true';
    if (sortOrder !== undefined) product.sortOrder = sortOrder;

    if (parsedRemoveImages && parsedRemoveImages.length > 0) {
      await deleteMultipleFromCloudinary(parsedRemoveImages);
      product.images = product.images.filter(
        (img) => !parsedRemoveImages.includes(img.public_id)
      );
    }

    if (newImages && Array.isArray(newImages) && newImages.length > 0) {
      product.images.push(...newImages);
    }

    if (product.images.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Product must have at least one image'
      });
    }

    const updatedProduct = await product.save();
    await updatedProduct.populate('category', 'name slug');

    res.json({
      success: true,
      message: 'Product updated successfully',
      data: updatedProduct
    });
  } catch (error) {
    if (req.body.newImages && Array.isArray(req.body.newImages)) {
      const publicIds = req.body.newImages.map((img) => img.public_id);
      await deleteMultipleFromCloudinary(publicIds);
    }

    res.status(500).json({
      success: false,
      message: 'Error updating product',
      error: error.message
    });
  }
});

// Admin: Delete product
router.delete('/product/:id', protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const publicIds = product.images.map((img) => img.public_id);
    if (publicIds.length > 0) {
      await deleteMultipleFromCloudinary(publicIds);
    }

    await Product.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting product',
      error: error.message
    });
  }
});

// Public: Search products
router.get('/products/search', async (req, res) => {
  try {
    const {
      q,
      category,
      minPrice,
      maxPrice,
      sort = '-createdAt',
      page = 1,
      limit = 12
    } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        message: 'Search query (q) is required'
      });
    }

    const filter = {
      isActive: true,
      $or: [
        { name: new RegExp(q, 'i') },
        { description: new RegExp(q, 'i') },
        { tags: new RegExp(q, 'i') }
      ]
    };

    if (category) filter.category = category;

    if (minPrice || maxPrice) {
      filter['price.original'] = {};
      if (minPrice) filter['price.original'].$gte = Number(minPrice);
      if (maxPrice) filter['price.original'].$lte = Number(maxPrice);
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(50, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const sortOptions = {
      '-createdAt': { createdAt: -1 },
      'createdAt': { createdAt: 1 },
      'price': { 'price.original': 1 },
      '-price': { 'price.original': -1 },
      'name': { name: 1 }
    };

    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .sort(sortOptions[sort] || { createdAt: -1 })
      .limit(limitNum)
      .skip(skip)
      .select('-__v');

    const total = await Product.countDocuments(filter);

    res.json({
      success: true,
      query: q,
      count: products.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: products
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error searching products',
      error: error.message
    });
  }
});

export default router