/**
 * Error message component
 */

import React from 'react';
import { Box, Text } from 'ink';

interface ErrorProps {
  message: string;
  details?: string[];
}

export function Error({ message, details }: ErrorProps) {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box>
        <Text color="red" bold>
          ✗ {message}
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
