
import { Client, TablesDB, Query } from 'node-appwrite';

export default async ({ req, res, log, error }) => {
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
        Query.limit(1)
      ]
    });

    return res.json({
      success: true,
      message: 'Pakhomo database connected!',
      approvedProperties: result.total
    });

  } catch (err) {
    error(err.message);

    return res.json({
      success: false,
      message: 'Database connection failed',
      error: err.message
    }, 500);
  }
};
