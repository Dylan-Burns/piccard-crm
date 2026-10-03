-- 0012_file_content_cleanup: finish the remediation started in 0010.
--
-- 0010 stopped new uploads of other content types but left anything stored before it as it was.
-- Any such object is now served as a plain download instead of with its original type, and any
-- `files` row that recorded such a type is corrected to match. Nothing is deleted.

update storage.objects
   set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{mimetype}', '"application/octet-stream"')
 where bucket_id = 'crm-files'
   and not coalesce(metadata->>'mimetype' = any (private.allowed_file_types()), false);

update public.files
   set mime_type = 'application/octet-stream', category = case when category = 'photo' then 'other' else category end
 where not (mime_type = any (private.allowed_file_types()));
