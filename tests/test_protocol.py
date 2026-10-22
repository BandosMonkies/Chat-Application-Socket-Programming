import unittest

from chat_app.protocol import ProtocolError, validate_message, validate_username


class ProtocolValidationTests(unittest.TestCase):
    def test_valid_message_is_trimmed(self):
        self.assertEqual(validate_message("  hello  "), "hello")

    def test_empty_message_is_rejected(self):
        with self.assertRaises(ProtocolError):
            validate_message("   ")

    def test_invalid_username_is_rejected(self):
        with self.assertRaises(ProtocolError):
            validate_username("not valid")


if __name__ == "__main__":
    unittest.main()
