-- Backfill: tag the 48 HDFC-SAMEDAY / Eros Mall machines (delivered 2026-09-04)
-- with a single batch label so they can be selected and bulk-assigned in one go.
-- Matched by TID (unique per machine). Only fills rows that aren't already tagged.
--
-- Run supabase-pos-upload-batch-migration.sql FIRST (adds the upload_batch column).

UPDATE pos_machines
SET upload_batch = 'HDFC-SAMEDAY Eros Mall 2026-09-04'
WHERE brand = 'HDFC-SAMEDAY'
  AND (upload_batch IS NULL OR upload_batch = '')
  AND tid IN (
    '43170136','43159310','43169221','43169215','43170132','43170121',
    '43169224','43169216','43169213','43169217','43170122','43170127',
    '43170130','43170126','43170120','43169226','43170125','43170123',
    '43170129','43169227','43170131','43169220','43169214','43169230',
    '43170133','43170124','43169218','43169219','43170119','43170134',
    '43170135','43169222','43170128','43169229','43169228','43169225',
    '43169223','43159317','43159312','43159316','43159313','43159314',
    '43159302','43159304','43159303','43159307','43159308','43159300'
  );

-- Verify: expect 48 rows.
SELECT upload_batch, count(*) AS machines
FROM pos_machines
WHERE upload_batch = 'HDFC-SAMEDAY Eros Mall 2026-09-04'
GROUP BY upload_batch;
