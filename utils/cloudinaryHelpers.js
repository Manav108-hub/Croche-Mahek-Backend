import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

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
    await Promise.all(publicIds.map(id => cloudinary.uploader.destroy(id)));
    console.log(`✅ Deleted ${publicIds.length} images`);
  } catch (error) {
    console.error('❌ Error deleting multiple images:', error.message);
  }
}
