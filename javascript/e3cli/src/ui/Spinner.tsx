/**
 * Spinner component for async operations
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

interface SpinnerProps {
  message: string;
}

export function LoadingSpinner({ message }: SpinnerProps) {
  return (
    <Box>
      <Text color="cyan">
        <Spinner type="dots" /> {message}
      </Text>
    </Box>
  );
}
