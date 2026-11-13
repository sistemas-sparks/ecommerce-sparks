import { publicCatalogSchema } from '@sparks/shared';
import snapshot from '../_data/catalog.json';

// A T-010 gera este snapshot público antes do build. Nunca usar service_role no web.
export const catalog = publicCatalogSchema.parse(snapshot);
export const categories = [...catalog.categories].sort((a, b) => a.position - b.position);
export const products = catalog.products;
export { categoryHref, productHref } from './paths';
export const whatsappHref = catalog.contact.whatsapp
  ? `https://wa.me/${catalog.contact.whatsapp}`
  : null;
