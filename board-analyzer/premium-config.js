// Where Premium is sold. Fill this in once the store product exists; nothing else in the code needs to change.
//
//   provider: 'lemonsqueezy' | 'gumroad' | 'none'
//     The shop's API origin must also be the one entry in manifest.json "optional_host_permissions"
//     (https://api.gumroad.com/* or https://api.lemonsqueezy.com/*); the store asks why any other is there.
//     'none'  -> the Premium page says "coming soon" and nothing can be bought yet (free features all work).
//   checkoutUrl: the page people buy on (Lemon Squeezy "Share" link or Gumroad product page).
//   priceLabel:  shown on the button, e.g. '$6.99 one-time'. Keep it in sync with the store.
//   lemonsqueezy.storeId / productIds: from the Lemon Squeezy dashboard. A key is only accepted if it was sold by
//     this store (and, if productIds is not empty, for one of these products), so keys from other shops can't unlock it.
//   gumroad.productId: the product's ID from Gumroad (Product > Content > License key section).
//   maxActivations: how many times one key may be activated (Lemon Squeezy enforces its own limit too). Gumroad counts
//     every activation and has no way to give one back when a key is removed, so a reinstall uses one up: keep it roomy.
export const PREMIUM_CONFIG = {
  provider: 'gumroad',
  checkoutUrl: 'https://vaibhavster44.gumroad.com/l/pawnshot',
  priceLabel: '$6.99 one-time',
  lemonsqueezy: { storeId: 0, productIds: [] },
  gumroad: { productId: 'QnTcndUyx5hiccdz79Ny2A==' },
  maxActivations: 5,
};
