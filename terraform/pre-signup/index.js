exports.handler = async (event) => {
  const email = event.request.userAttributes.email || "";
  const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN || "amazon.com";
  if (!email.endsWith(`@${allowedDomain}`)) {
    throw new Error(`Registration is restricted to @${allowedDomain} email addresses.`);
  }
  return event;
};
