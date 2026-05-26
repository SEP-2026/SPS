Place frontend image assets for Smart Parking here.

Expected filenames used by the app (place these files in this folder):

- logo.png              -> referenced in Home page sidebar
- hero-car.png          -> hero illustration used on Home page
- avatar.jpg            -> user avatar placeholder
- parking-placeholder.jpg -> fallback image for parking cards
- car-top-view.png      -> car top view image used in slot cards
- car-top-view2.png     -> alternate car top view
- owner-promo-car.png   -> owner promo image

Access assets in the app via `/assets/images/<filename>` (e.g. `/assets/images/logo.png`).

If you're using Vite, files placed in `public/` are served at the site root. This folder is `public/assets/images/` so the public path is `/assets/images/`.