
export default async ({ req, res, log, error }) => {
  log('Pakhomo API is running');

  return res.json({
    success: true,
    message: 'Pakhomo API is running!',
    method: req.method
  });
};
