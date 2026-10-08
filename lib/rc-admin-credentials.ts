import { z } from 'zod';

export const rcAdminCredentialsBaseSchema = z.object({
  adminAuthMethod: z.enum(['password', 'personal_token']).default('password'),
  adminUsername: z.string().trim().max(256).default(''),
  adminPassword: z.string().max(4096).default(''),
  adminTotpCode: z.string().trim().max(128).default(''),
  adminPersonalToken: z.string().trim().max(4096).default(''),
  adminUserId: z.string().trim().max(256).default(''),
});
export type RcAdminCredentials = z.infer<typeof rcAdminCredentialsBaseSchema>;

export function validateRcAdminCredentials(value: RcAdminCredentials, context: z.RefinementCtx) {
  const fields = value.adminAuthMethod === 'personal_token'
    ? [['adminPersonalToken', 'Укажите личный токен Rocket.Chat.'], ['adminUserId', 'Укажите User ID владельца токена.']] as const
    : [['adminUsername', 'Укажите логин администратора Rocket.Chat.'], ['adminPassword', 'Укажите пароль администратора Rocket.Chat.']] as const;
  for (const [field, message] of fields) {
    if (!value[field]) context.addIssue({ code: 'custom', path: [field], message });
  }
}
export const rcAdminCredentialsSchema = rcAdminCredentialsBaseSchema.superRefine(validateRcAdminCredentials);

export function rcAdminCredentialsPayload(value: RcAdminCredentials) {
  return value.adminAuthMethod === 'personal_token'
    ? { adminAuthMethod: value.adminAuthMethod, adminPersonalToken: value.adminPersonalToken.trim(), adminUserId: value.adminUserId.trim() }
    : { adminAuthMethod: value.adminAuthMethod, adminUsername: value.adminUsername.trim(), adminPassword: value.adminPassword, adminTotpCode: value.adminTotpCode.trim() };
}
