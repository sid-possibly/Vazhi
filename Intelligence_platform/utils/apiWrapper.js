// Utility to handle external API failures gracefully 
const fetchWithRetry = async (apiFunc, retries = 3, delay = 1000) => {
  try {
    return await apiFunc();
  } catch (err) {
    if (retries > 0) {
      // Wait for 'delay' milliseconds, then try again
      await new Promise(res => setTimeout(res, delay));
      return fetchWithRetry(apiFunc, retries - 1, delay * 2); // Exponential backoff
    }
    throw err; // If all retries fail, then throw the error
  }
};

module.exports = { fetchWithRetry };