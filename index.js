
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

const allowedTypes = [
  'image/jpeg',
  'image/png',
  'image/webp'
];

export default async ({ req, res, log, error }) => {
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key']);

  const tablesDB = new TablesDB(client);
  const storage = new Storage(client);

  // PUBLIC PROPERTY LISTINGS
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
        imageUrl: row.ImageField,
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
        message: 'Unable to retrieve properties'
      }, 500);
    }
  }

  // PROPERTY SUBMISSIONS
  if (req.method === 'POST') {
    let uploadedFileId = null;

    try {
      const contentType = req.headers['content-type'] || '';

      if (!contentType.includes('multipart/form-data')) {
        return res.json({
          success: false,
          message: 'Send property data and image as multipart form data.'
        }, 400);
      }

      const form = await new Response(req.bodyBinary, {
        headers: {
          'content-type': contentType
        }
      }).formData();

      const propertyText = form.get('property');
      const image = form.get('image');

      if (typeof propertyText !== 'string' || !image || typeof image === 'string') {
        return res.json({
          success: false,
          message: 'Property information and one image are required.'
        }, 400);
      }

      const property = JSON.parse(propertyText);

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
        'bedrooms',
        'bathrooms',
        'ownerName',
        'ownerPhone',
        'ownerEmail'
      ];

      for (const field of requiredFields) {
        if (
          property[field] === undefined ||
          property[field] === null ||
          property[field] === ''
        ) {
          return res.json({
            success: false,
            message: `Missing required field: ${field}`
          }, 400);
        }
      }

      if (!['MW', 'CD'].includes(property.countryCode)) {
        return res.json({ success: false, message: 'Invalid country.' }, 400);
      }

      if (!['House', 'Apartment', 'Land', 'Shop', 'Office', 'Hotel'].includes(property.type)) {
        return res.json({ success: false, message: 'Invalid property type.' }, 400);
      }

      if (!['Rent', 'Sale'].includes(property.listingType)) {
        return res.json({ success: false, message: 'Invalid listing type.' }, 400);
      }

      if (!['MWK', 'USD', 'CDF'].includes(property.currency)) {
        return res.json({ success: false, message: 'Invalid currency.' }, 400);
      }

      if (
        !Number.isFinite(Number(property.price)) ||
        Number(property.price) <= 0 ||
        !Number.isInteger(Number(property.bedrooms)) ||
        Number(property.bedrooms) < 0 ||
        !Number.isInteger(Number(property.bathrooms)) ||
        Number(property.bathrooms) < 0
      ) {
        return res.json({
          success: false,
          message: 'Invalid price or room count.'
        }, 400);
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(property.ownerEmail)) {
        return res.json({ success: false, message: 'Invalid email address.' }, 400);
      }

      if (!allowedTypes.includes(image.type) || image.size > 5 * 1024 * 1024) {
        return res.json({
          success: false,
          message: 'Use a JPEG, PNG or WebP image up to 5 MB.'
        }, 400);
      }

      const safeName = image.name.replace(/[^a-zA-Z0-9._-]/g, '_');

      const imageBuffer = Buffer.from(await image.arrayBuffer());

      const uploadedFile = await storage.createFile({
        bucketId: BUCKET_ID,
        fileId: ID.unique(),
        file: InputFile.fromBuffer(imageBuffer, safeName),
        permissions: []
      });

      uploadedFileId = uploadedFile.$id;

      const row = await tablesDB.createRow({
        databaseId: DATABASE_ID,
        tableId: TABLE_ID,
        rowId: ID.unique(),
        data: {
          Title: property.title,
          Description: property.description,
          countryCode: property.countryCode,
          City: property.city,
          Area: property.area,
          propertyType: property.type,
          listingType: property.listingType,
          Price: Number(property.price),
          Currency: property.currency,
          Bedrooms: Number(property.bedrooms),
          Bathrooms: Number(property.bathrooms),
          ImageField: uploadedFile.$id,
          ownerName: property.ownerName,
          ownerPhone: property.ownerPhone,
          ownerEmail: property.ownerEmail,
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
