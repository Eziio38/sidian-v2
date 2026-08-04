-- SID-SEC-006 — catégories de rate limiting des points d'entrée sensibles.
--
-- PostgreSQL interdit d'utiliser une nouvelle valeur d'enum dans la même
-- transaction que son ajout. Cette migration ne fait donc qu'étendre l'enum ;
-- la fonction consommatrice est remplacée dans la migration suivante.

alter type public.public_rate_limit_category
  add value if not exists 'auth_signup_ip';
alter type public.public_rate_limit_category
  add value if not exists 'auth_signup_email';
alter type public.public_rate_limit_category
  add value if not exists 'auth_signin_ip';
alter type public.public_rate_limit_category
  add value if not exists 'auth_signin_email';
alter type public.public_rate_limit_category
  add value if not exists 'auth_password_reset_ip';
alter type public.public_rate_limit_category
  add value if not exists 'auth_password_reset_email';
alter type public.public_rate_limit_category
  add value if not exists 'auth_password_update_ip';
alter type public.public_rate_limit_category
  add value if not exists 'auth_password_update_user';
alter type public.public_rate_limit_category
  add value if not exists 'auth_callback_ip';
alter type public.public_rate_limit_category
  add value if not exists 'auth_callback_code';
alter type public.public_rate_limit_category
  add value if not exists 'stripe_webhook_ip';
