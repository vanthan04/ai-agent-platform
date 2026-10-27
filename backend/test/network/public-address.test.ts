import { describe, expect, it } from "vitest";
import { isPublicAddress } from "../../src/network";

const PUBLIC = [
  "8.8.8.8",
  "1.1.1.1",
  "93.184.216.34",
  "172.15.255.255",
  "172.32.0.1",
  "100.63.255.255",
  "100.128.0.1",
  "192.169.0.1",
  "198.17.0.1",
  "198.20.0.1",
  "223.255.255.254",
  "2606:4700:4700::1111",
  "2001:4860:4860::8888",
  "2a00:1450:4009:81f::200e",
  "2001:200::1",
  "::ffff:8.8.8.8",
  "64:ff9b::808:808",
];

const NOT_PUBLIC_V4 = [
  "0.0.0.0",
  "0.1.2.3",
  "10.0.0.1",
  "10.255.255.255",
  "100.64.0.1",
  "100.127.255.255",
  "127.0.0.1",
  "127.255.255.254",
  "169.254.169.254",
  "172.16.0.1",
  "172.31.255.255",
  "192.0.0.1",
  "192.0.2.1",
  "192.88.99.1",
  "192.168.0.1",
  "198.18.0.1",
  "198.19.255.255",
  "198.51.100.1",
  "203.0.113.1",
  "224.0.0.1",
  "239.255.255.255",
  "240.0.0.1",
  "255.255.255.255",
];

const NOT_PUBLIC_V6 = [
  "::",
  "::1",
  "0:0:0:0:0:0:0:1",
  "fe80::1",
  "fc00::1",
  "fd00::1234",
  "ff02::1",
  "1::1",
  "2001:db8::1",
  "2001::1",
  "2001:1ff::1",
  "2002::1",
  "3fff::1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "::ffff:10.0.0.1",
  "::ffff:169.254.169.254",
  "::ffff:192.168.1.1",
  "64:ff9b::7f00:1",
  "64:ff9b::a00:1",
  "fe80::1%eth0",
];

const NOT_ADDRESSES = ["localhost", "example.com", "", "256.1.1.1", "1.2.3", "1.2.3.4.5", "0x7f.0.0.1", "2130706433", "017700000001", "::g", "::1::2", "[::1]"];

describe("isPublicAddress", () => {
  it.each(PUBLIC)("accepts the public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each(NOT_PUBLIC_V4)("refuses the non-public IPv4 address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(NOT_PUBLIC_V6)("refuses the non-public IPv6 address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(NOT_ADDRESSES)("refuses %j, which is not a plain IP address", (value) => {
    expect(isPublicAddress(value)).toBe(false);
  });
});
