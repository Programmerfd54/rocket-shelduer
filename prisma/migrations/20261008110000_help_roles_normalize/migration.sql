-- Справка: в массивах roles хранятся имена ролей. После переименования ролей (SUPPORT→SUP, ADMIN→LEAD_SUP,
-- VOL/USER→MEMBER, CITY_ADMIN/HQ_ADMIN→ADM/LEAD_SUP) приводим сохранённые значения к актуальным,
-- чтобы видимость материалов не пропала. Пустой массив («для всех») не затрагивается; дубликаты убираются.
UPDATE "HelpCatalog" SET roles = ARRAY(
  SELECT DISTINCT CASE r
    WHEN 'SUPPORT' THEN 'SUP' WHEN 'ADMIN' THEN 'LEAD_SUP' WHEN 'VOL' THEN 'MEMBER' WHEN 'USER' THEN 'MEMBER'
    WHEN 'CITY_ADMIN' THEN 'ADM' WHEN 'HQ_ADMIN' THEN 'LEAD_SUP' ELSE r END
  FROM unnest(roles) AS r
) WHERE cardinality(roles) > 0;

UPDATE "HelpInstruction" SET roles = ARRAY(
  SELECT DISTINCT CASE r
    WHEN 'SUPPORT' THEN 'SUP' WHEN 'ADMIN' THEN 'LEAD_SUP' WHEN 'VOL' THEN 'MEMBER' WHEN 'USER' THEN 'MEMBER'
    WHEN 'CITY_ADMIN' THEN 'ADM' WHEN 'HQ_ADMIN' THEN 'LEAD_SUP' ELSE r END
  FROM unnest(roles) AS r
) WHERE cardinality(roles) > 0;

UPDATE "HelpFAQ" SET roles = ARRAY(
  SELECT DISTINCT CASE r
    WHEN 'SUPPORT' THEN 'SUP' WHEN 'ADMIN' THEN 'LEAD_SUP' WHEN 'VOL' THEN 'MEMBER' WHEN 'USER' THEN 'MEMBER'
    WHEN 'CITY_ADMIN' THEN 'ADM' WHEN 'HQ_ADMIN' THEN 'LEAD_SUP' ELSE r END
  FROM unnest(roles) AS r
) WHERE cardinality(roles) > 0;
