import { Icon } from '@iconify/react';
import { Box, Button, ButtonProps, IconButton, Tooltip } from '@mui/material';
import React from 'react';
import { AccessCheck } from '../../api/rbac';
import { useCan } from '../../hooks/useCan';

interface GuardedButtonProps extends Omit<ButtonProps, 'children'> {
  /** Permission required to enable the button. */
  check: AccessCheck | null;
  label: string;
  icon: string;
  /** Render as an icon-only button with the label as tooltip. */
  iconOnly?: boolean;
}

/**
 * Button that is disabled (with the reason in a tooltip) when the user lacks the permission.
 */
export function GuardedButton({
  check,
  label,
  icon,
  iconOnly,
  disabled,
  ...rest
}: GuardedButtonProps) {
  const can = useCan(check);
  const blocked = can.allowed === false;
  const tooltip = blocked ? can.reason || '' : iconOnly ? label : '';
  const button = iconOnly ? (
    <IconButton
      aria-label={label}
      disabled={disabled || blocked || can.allowed === undefined}
      {...(rest as object)}
    >
      <Icon icon={icon} width={20} />
    </IconButton>
  ) : (
    <Button
      startIcon={<Icon icon={icon} />}
      disabled={disabled || blocked || can.allowed === undefined}
      {...rest}
    >
      {label}
    </Button>
  );
  return tooltip ? (
    <Tooltip title={tooltip}>
      <Box component="span" sx={{ display: 'inline-flex' }}>
        {button}
      </Box>
    </Tooltip>
  ) : (
    button
  );
}
