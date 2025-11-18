/**
 * Success message component
 */

import React from 'react';
import { Box, Text } from 'ink';

interface SuccessProps {
  message: string;
  details?: string[];
}

export function Success({ message, details }: SuccessProps) {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box>
        <Text color="green" bold>
          ✓ {message}
        </Text>
      </Box>
      {details && details.length > 0 && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {details.map((detail, i) => (
            <Text key={i} dimColor>
              {detail}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
