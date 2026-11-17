
import {
  Client,
  TablesDB,
  Storage,
  ID,
  Query
} from 'node-appwrite';

import { InputFile } from 'node-appwrite/file';

const DATABASE_ID = '6af03fb20005efbe0a7e';
const TABLE_ID = '6af040f70027940736cb';
const BUCKET_ID = '6af03fd9001df76cc2b7';

const FUNCTION_DOMAIN =
  'https://starter-function-dtms.fra.appwrite.run';

const allowedTypes = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

function validateImage(buffer, mimeType) {
  if (mimeType === 'image/jpeg') {
    return (
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff
    );
  }

  if (mimeType === 'image/png') {
    return buffer.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );
  }

  if (mimeType === 'image/webp') {
    return (
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    );
  }

  return false;
}

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key']);

  const tablesDB = new TablesDB(client);
  const storage = new Storage(client);

  // SECURE IMAGE DELIVERY
  if (req.method === 'GET' && req.path.startsWith('/images/')) {
    try {
      const fileId = decodeURIComponent(
        req.path.slice('/images/'.length)
      );

      if (!fileId || fileId.includes('/')) {
        return res.json({
          success: false,
          message: 'Invalid image ID.'
        }, 400);
      }

      // Only deliver images belonging to approved properties.
      const result = await tablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: TABLE_ID,
        queries: [
          Query.equal('ImageField', [fileId]),
          Query.equal('status', ['Approved']),
          Query.limit(1)
        ]
      });

      if (result.rows.length === 0) {
        return res.json({
          success: false,
          message: 'Image not available.'
        }, 404);
      }

      const file = await storage.getFile({
        bucketId: BUCKET_ID,
        fileId
      });

      if (!allowedTypes[file.mimeType]) {
        return res.json({
          success: false,
          message: 'Unsupported image type.'
        }, 415);
      }

      const image = await storage.getFileView({
        bucketId: BUCKET_ID,
        fileId
      });

      return res.binary(
        Buffer.from(image),
        200,
        {
          'Content-Type': file.mimeType,
          'Cache-Control': 'private, max-age=60',
          'X-Content-Type-Options': 'nosniff'
        }
      );

    } catch (err) {
      error('Image delivery failed: ' + err.message);

      return res.json({
        success: false,
        message: 'Unable to retrieve image.'
      }, 500);
    }
  }

  // PUBLIC APPROVED PROPERTY LIST
  if (req.method === 'GET') {
    try {
      const result = await tablesDB.listRows({
        databaseId: DATABASE_ID,
        tableId: TABLE_ID,
        queries: [
          Query.equal('status', ['Approved']),
          Query.limit(100)
        ]
      });

      const properties = result.rows.map(row => ({
        id: row.$id,
        title: row.Title,
        description: row.Description,
        countryCode: row.countryCode,
        city: row.City,
        area: row.Area,
        type: row.propertyType,
        listingType: row.listingType,
        price: row.Price,
        currency: row.Currency,
        bedrooms: row.Bedrooms,
        bathrooms: row.Bathrooms,
        size: row.size,
        imageUrl: `${FUNCTION_DOMAIN}/images/${encodeURIComponent(row.ImageField)}`,
        verified: row.verified
      }));

      return res.json({
        success: true,
        total: result.total,
        properties
      });

    } catch (err) {
      error(err.message);

      return res.json({
        success: false,
        message: 'Unable to retrieve properties.'
      }, 500);
    }
  }

  // PROPERTY SUBMISSION
  if (req.method === 'POST') {
    let uploadedFileId = null;

    try {
      const payload = req.bodyJson;

      if (!payload || typeof payload !== 'object') {
        return res.json({
          success: false,
          message: 'Invalid JSON request.'
        }, 400);
      }

      const property = payload.property;
      const imageData = payload.image;

      if (!property || typeof property !== 'object') {
        return res.json({
          success: false,
          message: 'Property information is required.'
        }, 400);
      }

      const requiredFields = [
        'title',
        'description',
        'countryCode',
        'city',
        'area',
        'type',
        'listingType',
        'price',
        'currency',
        'ownerName',
        'ownerPhone',
        'ownerEmail'
      ];

      for (const field of requiredFields) {
        if (
          property[field] === undefined ||
          property[field] === null ||
          String(property[field]).trim() === ''
        ) {
          return res.json({
            success: false,
            message: `Missing required field: ${field}`
          }, 400);
        }
      }

      if (!['MW', 'CD'].includes(property.countryCode)) {
        return res.json({
          success: false,
          message: 'Invalid country.'
        }, 400);
      }

      if (![
        'House',
        'Apartment',
        'Land',
        'Shop',
        'Office',
        'Hotel'
      ].includes(property.type)) {
        return res.json({
          success: false,
          message: 'Invalid property type.'
        }, 400);
      }

      if (!['Rent', 'Sale'].includes(property.listingType)) {
        return res.json({
          success: false,
          message: 'Invalid listing type.'
        }, 400);
      }

      if (!['MWK', 'USD', 'CDF'].includes(property.currency)) {
        return res.json({
          success: false,
          message: 'Invalid currency.'
        }, 400);
      }

      const price = Number(property.price);

      if (!Number.isFinite(price) || price <= 0) {
        return res.json({
          success: false,
          message: 'Invalid property price.'
        }, 400);
      }

      if (
        typeof property.ownerEmail !== 'string' ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(property.ownerEmail)
      ) {
        return res.json({
          success: false,
          message: 'Invalid email address.'
        }, 400);
      }

      if (
        typeof imageData !== 'string' ||
        imageData.length > 7 * 1024 * 1024
      ) {
        return res.json({
          success: false,
          message: 'A valid image up to 5 MB is required.'
        }, 400);
      }

      const match = imageData.match(
        /^data:(image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/
      );

      if (!match) {
        return res.json({
          success: false,
          message: 'Use a JPEG, PNG or WebP image.'
        }, 400);
      }

      const mimeType = match[1];
      const imageBuffer = Buffer.from(match[2], 'base64');

      if (
        imageBuffer.length === 0 ||
        imageBuffer.length > 5 * 1024 * 1024 ||
        !validateImage(imageBuffer, mimeType)
      ) {
        return res.json({
          success: false,
          message: 'The image is invalid or exceeds 5 MB.'
        }, 400);
      }

      const extension = allowedTypes[mimeType];
      const fileName = `property-${ID.unique()}.${extension}`;

      // Upload private image.
      const uploadedFile = await storage.createFile({
        bucketId: BUCKET_ID,
        fileId: ID.unique(),
        file: InputFile.fromBuffer(imageBuffer, fileName),
        permissions: []
      });

      uploadedFileId = uploadedFile.$id;

      // Save property as Pending.
      const row = await tablesDB.createRow({
        databaseId: DATABASE_ID,
        tableId: TABLE_ID,
        rowId: ID.unique(),
        data: {
          Title: String(property.title).trim(),
          Description: String(property.description).trim(),
          countryCode: property.countryCode,
          City: String(property.city).trim(),
          Area: String(property.area).trim(),
          propertyType: property.type,
          listingType: property.listingType,
          Price: price,
          Currency: property.currency,
          Bedrooms: Math.max(
            0,
            Math.floor(Number(property.bedrooms) || 0)
          ),
          Bathrooms: Math.max(
            0,
            Math.floor(Number(property.bathrooms) || 0)
          ),
          ImageField: uploadedFileId,
          ownerName: String(property.ownerName).trim(),
          ownerPhone: String(property.ownerPhone).trim(),
          ownerEmail: String(property.ownerEmail).trim(),
          status: 'Pending',
          verified: false
        }
      });

      return res.json({
        success: true,
        message: 'Property submitted successfully. Awaiting approval.',
        propertyId: row.$id,
        status: 'Pending'
      }, 201);

    } catch (err) {
      error(err.message);

      if (uploadedFileId) {
        try {
          await storage.deleteFile({
            bucketId: BUCKET_ID,
            fileId: uploadedFileId
          });
        } catch (cleanupError) {
          error('Image cleanup failed: ' + cleanupError.message);
        }
      }

      return res.json({
        success: false,
        message: 'Property submission failed.'
      }, 500);
    }
  }

  return res.json({
    success: false,
    message: 'Method not allowed.'
  }, 405);
};
