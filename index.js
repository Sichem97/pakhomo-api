
import { Client, TablesDB, Query } from 'node-appwrite';

export default async ({ req, res, error }) => {
  try {
    const client = new Client()
      .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
      .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
      .setKey(req.headers['x-appwrite-key']);

    const tablesDB = new TablesDB(client);

    const result = await tablesDB.listRows({
      databaseId: '6af03fb20005efbe0a7e',
      tableId: '6af040f70027940736cb',
      queries: [
        Query.equal('status', ['Approved']),
        Query.limit(100)
      ]
    });

    const properties = result.rows.map((row) => ({
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
};
