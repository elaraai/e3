/**
 * Info message component
 */

import React from 'react';
import { Box, Text } from 'ink';

interface InfoProps {
  message: string;
  details?: string[];
}

export function Info({ message, details }: InfoProps) {
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box>
        <Text color="blue" bold>
          ℹ {message}
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
